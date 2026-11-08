"""Live mirror of the router's ARP table, held only while at least one page is subscribed.

The first subscriber starts a RouterOS session (`/ip/arp/listen` + `/ip/arp/print` on one
connection); the last one to leave cancels it, which closes the connection. Rows are
enriched with the NetBox object owning their MAC.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .netbox import MacMatch
from .routeros import RouterOsConnection, RouterOsError

log = logging.getLogger(__name__)

ACTIVE = frozenset({"reachable", "stale", "delay", "probe", "permanent"})
DISCONNECTED = frozenset({"failed", "incomplete"})
MAC_TTL_S = 300
QUEUE_SIZE = 500

Event = dict[str, Any]


def presence(status: str) -> str:
    if status in ACTIVE:
        return "active"
    if status in DISCONNECTED:
        return "disconnected"
    return "unknown"


def _flag(value: str | None) -> bool:
    return value in ("true", "yes")


def row_from_attrs(attrs: dict[str, str]) -> dict[str, Any]:
    status = attrs.get("status", "")
    return {
        "id": attrs[".id"],
        "address": attrs.get("address", ""),
        "mac": attrs.get("mac-address", "").upper(),
        "interface": attrs.get("interface", ""),
        "status": status,
        "presence": presence(status),
        "dhcp": _flag(attrs.get("dhcp")),
        "dynamic": _flag(attrs.get("dynamic")),
        "disabled": _flag(attrs.get("disabled")),
    }


class ArpHub:
    def __init__(
        self,
        connect: Callable[[], Awaitable[RouterOsConnection]],
        load_macs: Callable[[], Awaitable[dict[str, MacMatch]]],
    ) -> None:
        self._connect = connect
        self._load_macs = load_macs
        self._macs: dict[str, MacMatch] = {}
        self._macs_at = 0.0
        self._rows: dict[str, dict[str, Any]] = {}
        self._raw: dict[str, dict[str, str]] = {}
        self._leases: dict[str, dict[str, str]] = {}
        self._subscribers: set[asyncio.Queue[Event]] = set()
        self._task: asyncio.Task[None] | None = None
        self.state = "idle"
        self.error: str | None = None

    # ---- subscribers ----

    def subscribe(self) -> asyncio.Queue[Event]:
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._subscribers.add(queue)
        if self._task is None or self._task.done():
            self._rows.clear()
            self._task = asyncio.create_task(self._run(), name="arp-mirror")
        queue.put_nowait(self._status_event())
        if self.state == "live":
            queue.put_nowait(self._snapshot_event())
        return queue

    def unsubscribe(self, queue: asyncio.Queue[Event]) -> None:
        """Synchronous on purpose: it runs in the `finally` of a cancelled response stream."""
        self._subscribers.discard(queue)
        if not self._subscribers and self._task is not None:
            self._task.cancel()
            self._task = None
            self._rows.clear()
            self.state = "idle"
            self.error = None

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def _broadcast(self, event: Event) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # A stalled client: replace its backlog with a fresh snapshot.
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(self._snapshot_event())

    # ---- events ----

    def _static_lease(self, address: str) -> dict[str, str] | None:
        for lease in self._leases.values():
            if lease.get("address") == address and not _flag(lease.get("dynamic")):
                return lease
        return None

    def enrich(self, row: dict[str, Any]) -> dict[str, Any]:
        """NetBox match by MAC. An entry without a MAC (failed / incomplete) borrows
        the MAC of the router's static DHCP lease for its address."""
        lease = self._static_lease(row["address"])
        lease_mac = (lease or {}).get("mac-address", "").upper()
        mac, mac_source = row["mac"], "arp"
        if not mac and lease_mac:
            mac, mac_source = lease_mac, "lease"
        match = self._macs.get(mac) if mac else None
        lease_info = (
            {"name": lease.get("comment") or lease.get("host-name") or None, "mac": lease_mac}
            if lease
            else None
        )
        return {
            **row,
            "mac": mac,
            "macSource": mac_source if mac else None,
            "lease": lease_info,
            "netbox": match.as_json() if match else None,
        }

    def apply_lease(self, attrs: dict[str, str]) -> bool:
        """Updates the lease table; True when a static lease changed."""
        lease_id = attrs.get(".id")
        if not lease_id:
            return False
        old = self._leases.get(lease_id)
        if _flag(attrs.get(".dead")):
            self._leases.pop(lease_id, None)
            return old is not None and not _flag(old.get("dynamic"))
        merged = {**(old or {}), **attrs}
        self._leases[lease_id] = merged
        relevant = ("address", "mac-address", "comment", "host-name", "dynamic")
        changed = old is None or any(old.get(k) != merged.get(k) for k in relevant)
        was_static = old is not None and not _flag(old.get("dynamic"))
        return changed and (was_static or not _flag(merged.get("dynamic")))

    def _snapshot_event(self) -> Event:
        return {"type": "snapshot", "rows": [self.enrich(r) for r in self._rows.values()]}

    def _status_event(self) -> Event:
        return {"type": "status", "state": self.state, "error": self.error}

    def _set_state(self, state: str, error: str | None = None) -> None:
        self.state, self.error = state, error
        self._broadcast(self._status_event())

    def apply(self, attrs: dict[str, str], broadcast: bool) -> None:
        row_id = attrs.get(".id")
        if not row_id:
            return
        if _flag(attrs.get(".dead")):
            if self._rows.pop(row_id, None) is not None and broadcast:
                self._broadcast({"type": "remove", "id": row_id})
            return
        # `listen` sends full records; merge anyway in case a reply is partial.
        merged = {**self._raw.get(row_id, {}), **attrs}
        self._raw[row_id] = merged
        row = row_from_attrs(merged)
        if self._rows.get(row_id) == row:
            return
        self._rows[row_id] = row
        if broadcast:
            self._broadcast({"type": "upsert", "row": self.enrich(row)})

    async def _refresh_macs(self) -> None:
        try:
            self._macs = await self._load_macs()
            self._macs_at = time.monotonic()
        except Exception as exc:  # NetBox down: keep the last directory, rows stay unenriched
            log.warning("NetBox MAC directory refresh failed: %s", exc)
            self._macs_at = time.monotonic()

    # ---- session ----

    async def _run(self) -> None:
        backoff = 2.0
        while self._subscribers:
            try:
                await self._session()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("ARP mirror session failed: %s", exc)
                self._set_state("error", str(exc))
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60.0)
            else:
                backoff = 2.0

    async def _session(self) -> None:
        self._set_state("connecting")
        if time.monotonic() - self._macs_at > MAC_TTL_S or not self._macs:
            await self._refresh_macs()
        conn = await self._connect()
        self._rows.clear()
        self._raw.clear()
        self._leases.clear()
        pending = {"print", "lease-print"}
        try:
            conn.send(["/ip/arp/listen", ".tag=listen"])
            conn.send(["/ip/dhcp-server/lease/listen", ".tag=lease-listen"])
            conn.send(["/ip/arp/print", ".tag=print"])
            conn.send(["/ip/dhcp-server/lease/print", ".tag=lease-print"])
            async for reply in conn.replies():
                if reply.word in ("!trap", "!fatal"):
                    raise RouterOsError(reply.attrs.get("message", reply.word))
                printing = bool(pending)
                if reply.word == "!done" and reply.tag in pending:
                    pending.discard(reply.tag)
                    if not pending:
                        self.state, self.error = "live", None
                        self._broadcast(self._status_event())
                        self._broadcast(self._snapshot_event())
                    continue
                if reply.word != "!re":
                    continue
                if reply.tag in ("lease-listen", "lease-print"):
                    if self.apply_lease(reply.attrs) and not printing:
                        self._broadcast(self._snapshot_event())
                    continue
                self.apply(reply.attrs, broadcast=not printing)
                if not printing and time.monotonic() - self._macs_at > MAC_TTL_S:
                    await self._refresh_macs()
                    self._broadcast(self._snapshot_event())
        finally:
            await conn.close()
