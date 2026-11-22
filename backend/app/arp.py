"""Live mirror of the router's ARP table: the `arp` source of the stream hub.

While the hub runs it, it holds one RouterOS session (`/ip/arp/listen` + `/ip/arp/print`
on one connection); the hub cancels it when no page is subscribed any more, which closes
the connection. Rows are enriched with the NetBox object owning their MAC; the MAC
directory comes from the `inventory` source (`set_macs`).
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from .hub import Event, Source
from .netbox import MacMatch
from .routeros import RouterOsConnection, RouterOsError, describe, log_detail

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ClientHints:
    """What the mirror knows about a MAC, for naming Wi-Fi clients: its DHCP lease and address."""

    lease_comment: str | None = None
    lease_host_name: str | None = None
    ip: str | None = None

ACTIVE = frozenset({"reachable", "stale", "delay", "probe", "permanent"})
DISCONNECTED = frozenset({"failed", "incomplete"})


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


class ArpSource(Source):
    name = "arp"

    def __init__(self, connect: Callable[[], Awaitable[RouterOsConnection]]) -> None:
        super().__init__()
        self._connect = connect
        self._macs: dict[str, MacMatch] = {}
        self._rows: dict[str, dict[str, Any]] = {}
        self._raw: dict[str, dict[str, str]] = {}
        self._leases: dict[str, dict[str, str]] = {}
        self.state = "idle"
        self.error: str | None = None
        #: Called as `callback(address, transition)` on presence transitions of an address while
        #: the mirror is live (never for the initial table): "failed" (now failed / incomplete),
        #: "removed" (dropped from the table while active), "appeared" (active after being absent
        #: or failed). reachable <-> stale and the like are not transitions.
        self.on_transition: list[Callable[[str, str], None]] = []

    # ---- source interface ----

    def initial_events(self) -> list[Event]:
        events = [self._status_event()]
        if self.state == "live":
            events.append(self._snapshot_event())
        return events

    def stopped(self) -> None:
        self._rows.clear()
        self.state = "idle"
        self.error = None

    def health(self) -> dict[str, Any]:
        return {"state": self.state, "error": self.error}

    def set_macs(self, macs: dict[str, MacMatch]) -> None:
        """A new MAC directory: re-enrich the rows on every page."""
        if macs == self._macs:
            return
        self._macs = macs
        if self.state == "live":
            self.publish(self._snapshot_event())

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

    def hints(self, mac: str) -> ClientHints:
        """For the Wi-Fi source: the DHCP lease (comment, host name, address) and the ARP address
        of a MAC, from the mirror's tables (empty while the mirror is not live)."""
        mac = mac.upper()
        lease = next((le for le in self._leases.values() if le.get("mac-address", "").upper() == mac), None)
        arp_ip = next((r["address"] for r in self._rows.values() if r["mac"] == mac and r["address"]), None)
        return ClientHints(
            lease_comment=(lease or {}).get("comment") or None,
            lease_host_name=(lease or {}).get("host-name") or None,
            ip=(lease or {}).get("address") or arp_ip,
        )

    def _snapshot_event(self) -> Event:
        return {"type": "snapshot", "rows": [self.enrich(r) for r in self._rows.values()]}

    def _status_event(self) -> Event:
        return {"type": "status", "state": self.state, "error": self.error}

    def _set_state(self, state: str, error: str | None = None) -> None:
        self.state, self.error = state, error
        self.publish(self._status_event())

    def address_presence(self, address: str) -> str | None:
        """`active`, `disconnected`, or None when the address is not in the table (or only
        with an unknown status)."""
        found = {row["presence"] for row in self._rows.values() if row["address"] == address}
        if "active" in found:
            return "active"
        if "disconnected" in found:
            return "disconnected"
        return None

    def _notify(self, address: str, before: str | None) -> None:
        after = self.address_presence(address)
        if not address or after == before:
            return
        if after == "disconnected":
            transition = "failed"
        elif after is None and before == "active":
            transition = "removed"
        elif after == "active":
            transition = "appeared"
        else:
            return
        for callback in self.on_transition:
            callback(address, transition)

    def apply(self, attrs: dict[str, str], broadcast: bool) -> None:
        row_id = attrs.get(".id")
        if not row_id:
            return
        old = self._rows.get(row_id)
        addresses = {old["address"]} if old else set()
        before = {a: self.address_presence(a) for a in addresses}
        self._apply(row_id, attrs, broadcast)
        if not broadcast:
            return  # the initial table: no transitions
        new = self._rows.get(row_id)
        if new and new["address"] not in before:
            # A new row: its address was absent unless another row already carries it.
            others = [r for i, r in self._rows.items() if i != row_id and r["address"] == new["address"]]
            before[new["address"]] = (
                "active" if any(r["presence"] == "active" for r in others)
                else "disconnected" if any(r["presence"] == "disconnected" for r in others) else None
            )
        for address, presence in before.items():
            self._notify(address, presence)

    def _apply(self, row_id: str, attrs: dict[str, str], broadcast: bool) -> None:
        if _flag(attrs.get(".dead")):
            if self._rows.pop(row_id, None) is not None and broadcast:
                self.publish({"type": "remove", "id": row_id})
            return
        # `listen` sends full records; merge anyway in case a reply is partial.
        merged = {**self._raw.get(row_id, {}), **attrs}
        self._raw[row_id] = merged
        row = row_from_attrs(merged)
        if self._rows.get(row_id) == row:
            return
        self._rows[row_id] = row
        if broadcast:
            self.publish({"type": "upsert", "row": self.enrich(row)})

    # ---- session ----

    async def run(self) -> None:
        self._rows.clear()
        backoff = 2.0
        while True:
            try:
                await self._session()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("ARP mirror session failed: %s", log_detail(exc))
                self._set_state("error", describe(exc))
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60.0)
            else:
                backoff = 2.0

    async def _session(self) -> None:
        self._set_state("connecting")
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
                    raise RouterOsError("the router refused to follow the ARP table", reply.attrs.get("message", reply.word))
                printing = bool(pending)
                if reply.word == "!done" and reply.tag in pending:
                    pending.discard(reply.tag)
                    if not pending:
                        self.state, self.error = "live", None
                        self.publish(self._status_event())
                        self.publish(self._snapshot_event())
                    continue
                if reply.word != "!re":
                    continue
                if reply.tag in ("lease-listen", "lease-print"):
                    if self.apply_lease(reply.attrs) and not printing:
                        self.publish(self._snapshot_event())
                    continue
                self.apply(reply.attrs, broadcast=not printing)
        finally:
            await conn.close()
