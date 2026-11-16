"""The `services` source: HTTP checks of the NetBox services, driven by events.

It keeps the latest result per target and publishes the whole list, in the shape the former
`GET /api/service-status` returned (name, url, up, code, error, service_id, public_url), only
when something changed. Checks run:

- as a full round of every target every `period_s` (180 s), when the inventory cycle brings a
  different target list, and on `refresh()`;
- for the targets of one host, on ARP presence transitions of the host's address (the address
  in the target URL):
  - `failed` (failed / incomplete: the router got no answer): marked down at once, no check;
  - `removed` (dropped from the table while active): one check now (the router also drops
    idle hosts, so this alone is no proof);
  - `appeared` (active after being absent or failed): checks after 5, 15, 30 and 60 s;
- for the targets of one container (the NetBox VM the container entry maps to), on container
  state changes: not running -> marked down at once; running -> checks after 5, 15 and 30 s.

Per host (and per container) a newer transition replaces the pending checks. Event-driven
checks touch only the affected targets and publish the merged list.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from .checks import ServiceChecker, public_url_for
from .hub import Event, Source
from .inventory import InventoryParts, InventorySource, InventoryUnavailable
from .netbox import Target
from .polling import CONNECTING, ERROR, IDLE, LIVE, iso, utc_now

log = logging.getLogger(__name__)

Json = dict[str, Any]

ARP_FAILED_ERROR = "Host does not answer ARP"
CONTAINER_DOWN_ERROR = "Container is not running"
ARP_APPEARED_DELAYS_S = (5.0, 15.0, 30.0, 60.0)
ARP_REMOVED_DELAYS_S = (0.0,)
CONTAINER_STARTED_DELAYS_S = (5.0, 15.0, 30.0)


def target_host(target: Target) -> str | None:
    return urlsplit(target.url).hostname


def container_vm_ids(env: str, name: str, inventory: Json | None) -> list[int]:
    """NetBox VM ids of the Docker container entry (`env`, `name`), with the page's rule
    (src/domain/containerStatuses.ts): the Docker VM whose `alias` equals the entry name; when
    several share it, the one whose host VM is named like the environment."""
    if not inventory:
        return []
    vms = inventory.get("virtual_machine_list") or []
    names = {str(vm.get("id")): vm.get("name") for vm in vms}
    candidates = []
    for vm in vms:
        if (vm.get("virtual_machine_type") or {}).get("name") != "Docker":
            continue
        alias = (vm.get("custom_fields") or {}).get("alias")
        if isinstance(alias, str) and alias.strip() and alias.strip() == name:
            candidates.append(vm)
    if len(candidates) > 1:
        candidates = [vm for vm in candidates if names.get(_host_id(vm)) == env][:1]
    return [int(vm["id"]) for vm in candidates]


def _host_id(vm: Json) -> str | None:
    host = (vm.get("custom_fields") or {}).get("host")
    if isinstance(host, dict):
        host = host.get("id")
    if isinstance(host, int) or (isinstance(host, str) and host.strip()):
        return str(host).strip()
    return None


class ServicesSource(Source):
    name = "services"

    def __init__(
        self,
        inventory: InventorySource,
        checker: ServiceChecker,
        period_s: float = 180.0,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        super().__init__()
        self._inventory = inventory
        self._checker = checker
        self.period_s = period_s
        self._clock = clock
        self._wake = asyncio.Event()
        self._round_lock = asyncio.Lock()
        self._running = False
        self._scheduled: dict[tuple[str, Any], asyncio.Task[None]] = {}
        self._target_names: tuple[str, ...] | None = None
        #: Target name -> latest result.
        self.results: dict[str, Json] = {}
        self.data: list[Json] = []
        self.has_data = False
        self.state = IDLE
        self.error: str | None = None
        self.updated_at: datetime | None = None
        self.round_at: float | None = None  # time.monotonic() of the last completed round
        self.rounds = 0

    # ---- source interface ----

    async def run(self) -> None:
        self._running = True
        self._set_status(CONNECTING, None)
        try:
            while True:
                self._wake.clear()
                await self.round()
                try:
                    await asyncio.wait_for(self._wake.wait(), self.period_s)
                except TimeoutError:
                    pass
        finally:
            self._running = False
            self._cancel_scheduled()

    def initial_events(self) -> list[Event]:
        events = [self._status_event()]
        if self.has_data:
            events.append({"type": "data", "data": self.data})
        return events

    def stopped(self) -> None:
        self._running = False
        self._cancel_scheduled()
        self.state, self.error = IDLE, None

    def health(self) -> Json:
        return {"state": self.state, "error": self.error, "updatedAt": iso(self.updated_at),
                "periodS": self.period_s, "targets": len(self.results), "pending": len(self._scheduled)}

    def refresh(self) -> None:
        """A full round now. No-op while the source is stopped."""
        if self._running:
            self._wake.set()

    # ---- full rounds ----

    async def targets(self) -> list[Target]:
        """The current targets. While the hub runs the inventory source, its parts are read as
        they are (waiting only for its first cycle), so checks never cause extra NetBox reads;
        without subscribers an inventory cycle runs first when none ran within its period."""
        if self._running:
            if self._inventory.last_cycle_at is None:
                await self._inventory.ensure_fresh()
            if self._inventory.parts.targets is None:
                raise InventoryUnavailable(self._inventory.parts.errors.get("targets") or "NetBox is unreachable.")
            return self._current_targets()
        return await self._checker.targets()

    async def round(self) -> None:
        async with self._round_lock:
            await self._round()

    async def latest(self) -> list[Json]:
        """For `GET /api/service-status`: the latest list, after a round when there is no result
        younger than the period (no page subscribed)."""
        async with self._round_lock:
            loop = asyncio.get_running_loop()
            if self.round_at is None or loop.time() - self.round_at > self.period_s:
                await self._round()
                if self.state == ERROR and not self.has_data:
                    raise InventoryUnavailable(self.error or "NetBox is unreachable.")
        return self.data

    async def _round(self) -> None:
        try:
            targets = await self.targets()
        except InventoryUnavailable as exc:
            self._set_status(ERROR, str(exc))
            return
        self._target_names = tuple(t.name for t in targets)
        results = await self._run_checks(targets)
        self.results = {r["name"]: r for r in results}
        self.rounds += 1
        self.round_at = asyncio.get_running_loop().time()
        self.updated_at = self._clock()
        self._publish_data(targets)
        self._set_status(LIVE, None, force=True)

    async def _run_checks(self, targets: list[Target]) -> list[Json]:
        return await self._checker.check(targets, self._inventory.parts.public_urls or {})

    # ---- triggers ----

    def on_inventory(self, parts: InventoryParts) -> None:
        """After an inventory cycle: a different target list means a full round now."""
        if parts.targets is None or not self._running or self._target_names is None:
            return
        names = tuple(t.name for t in self._checker.allowed(parts.targets))
        if names != self._target_names:
            self.refresh()

    def on_arp(self, address: str, transition: str) -> None:
        if not self._running:
            return
        key = ("host", address)

        def affected() -> list[Target]:
            return [t for t in self._current_targets() if target_host(t) == address]

        if transition == "failed":
            self._cancel(key)
            self._mark_down(affected(), ARP_FAILED_ERROR)
        elif transition == "removed":
            self._schedule(key, affected, ARP_REMOVED_DELAYS_S)
        elif transition == "appeared":
            self._schedule(key, affected, ARP_APPEARED_DELAYS_S)

    def on_container(self, env: str, name: str, old_state: str | None, new_state: str | None) -> None:
        if not self._running or new_state is None:
            return
        vm_ids = container_vm_ids(env, name, self._inventory.parts.inventory)
        if not vm_ids:
            return
        key = ("container", tuple(vm_ids))

        def affected() -> list[Target]:
            return [t for t in self._current_targets() if t.parent_vm_id in vm_ids]

        if new_state.lower() == "running":
            if (old_state or "").lower() != "running":
                self._schedule(key, affected, CONTAINER_STARTED_DELAYS_S)
        else:
            self._cancel(key)
            self._mark_down(affected(), CONTAINER_DOWN_ERROR)

    def _current_targets(self) -> list[Target]:
        return self._checker.allowed(self._inventory.parts.targets or [])

    def _schedule(self, key: tuple[str, Any], affected: Callable[[], list[Target]], delays: tuple[float, ...]) -> None:
        self._cancel(key)
        self._scheduled[key] = asyncio.create_task(self._checks_later(key, affected, delays), name=f"services-{key}")

    def _cancel(self, key: tuple[str, Any]) -> None:
        task = self._scheduled.pop(key, None)
        if task is not None:
            task.cancel()

    def _cancel_scheduled(self) -> None:
        for task in self._scheduled.values():
            task.cancel()
        self._scheduled.clear()

    async def _checks_later(self, key: tuple[str, Any], affected: Callable[[], list[Target]], delays: tuple[float, ...]) -> None:
        elapsed = 0.0
        try:
            for at in delays:
                await asyncio.sleep(at - elapsed)
                elapsed = at
                targets = affected()
                if targets:
                    self._merge(await self._run_checks(targets))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Event-driven service checks failed")
        finally:
            if self._scheduled.get(key) is asyncio.current_task():
                del self._scheduled[key]

    def _mark_down(self, targets: list[Target], error: str) -> None:
        public = self._inventory.parts.public_urls or {}
        self._merge([
            {"name": t.name, "url": t.url, "up": False, "code": 0, "error": error,
             "service_id": t.service_id, "public_url": public_url_for(t, public)}
            for t in targets
        ])

    def _merge(self, results: list[Json]) -> None:
        if not results:
            return
        for result in results:
            self.results[result["name"]] = result
        self._publish_data(self._current_targets())

    # ---- publishing ----

    def _publish_data(self, targets: list[Target]) -> None:
        data = [self.results[t.name] for t in targets if t.name in self.results]
        if not self.has_data or data != self.data:
            self.data, self.has_data = data, True
            self.publish({"type": "data", "data": data})

    def _status_event(self) -> Event:
        return {"type": "status", "state": self.state, "error": self.error,
                "updatedAt": iso(self.updated_at), "periodS": self.period_s}

    def _set_status(self, state: str, error: str | None, force: bool = False) -> None:
        if not force and (state, error) == (self.state, self.error):
            return
        self.state, self.error = state, error
        self.publish(self._status_event())
