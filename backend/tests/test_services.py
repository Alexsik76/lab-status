import asyncio
from collections import Counter

import httpx
import pytest

from app import checks
from app import services as services_module
from app.checks import ServiceChecker
from app.inventory import InventoryParts, InventoryUnavailable
from app.netbox import Target
from app.services import ServicesSource, container_vm_ids

LOGS = Target("vm-a/logs", "http://192.0.2.20:9428", 1, parent_vm_id=11)
GRAFANA = Target("vm-a/grafana", "http://192.0.2.20:3000", 2, parent_vm_id=12)
NAS = Target("nas", "https://192.0.2.50:443", 3)
SKIPPED = Target("skipped", "http://192.0.2.60:80", 4)

INVENTORY = {
    "virtual_machine_list": [
        {"id": "10", "name": "vm-a", "virtual_machine_type": {"name": "KVM"}, "custom_fields": {}},
        {"id": "20", "name": "vm-b", "virtual_machine_type": {"name": "KVM"}, "custom_fields": {}},
        {"id": "11", "name": "logs", "virtual_machine_type": {"name": "Docker"},
         "custom_fields": {"alias": "victorialogs", "host": 10}},
        {"id": "12", "name": "grafana", "virtual_machine_type": {"name": "Docker"},
         "custom_fields": {"alias": "grafana", "host": 10}},
        # The same alias on two hosts: the environment name picks one.
        {"id": "21", "name": "agent-a", "virtual_machine_type": {"name": "Docker"},
         "custom_fields": {"alias": "portainer_agent", "host": 10}},
        {"id": "22", "name": "agent-b", "virtual_machine_type": {"name": "Docker"},
         "custom_fields": {"alias": "portainer_agent", "host": {"id": 20, "name": "vm-b"}}},
        {"id": "30", "name": "not-docker", "virtual_machine_type": {"name": "LXC"},
         "custom_fields": {"alias": "grafana"}},
    ],
}


@pytest.fixture(autouse=True)
def fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(checks, "RETRY_DELAY_S", 0)
    monkeypatch.setattr(services_module, "ARP_APPEARED_DELAYS_S", (0.02, 0.04, 0.06, 0.08))
    monkeypatch.setattr(services_module, "CONTAINER_STARTED_DELAYS_S", (0.02, 0.04, 0.06))


class FakeInventory:
    """The parts of InventorySource the services source reads."""

    def __init__(self, targets: list[Target] | None) -> None:
        self.parts = InventoryParts(
            inventory=INVENTORY, targets=targets, public_urls={("192.0.2.20", 9428): "https://logs.example.com"}
        )
        self.last_cycle_at: float | None = 0.0
        self.cycles = 0

    async def ensure_fresh(self) -> None:
        self.cycles += 1
        self.last_cycle_at = 1.0

    async def load_targets(self) -> list[Target]:
        await self.ensure_fresh()
        if self.parts.targets is None:
            raise InventoryUnavailable("NetBox is unreachable.")
        return self.parts.targets

    async def load_public_urls(self):
        return self.parts.public_urls or {}


class Hosts:
    """HTTP double for the checked services: `down` holds host:port that refuse."""

    def __init__(self) -> None:
        self.down: set[str] = set()
        self.hits: Counter[str] = Counter()

    def handler(self, request: httpx.Request) -> httpx.Response:
        port = request.url.port or (443 if request.url.scheme == "https" else 80)
        key = f"{request.url.host}:{port}"
        self.hits[key] += 1
        if key in self.down:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(200)

    def total(self) -> int:
        return sum(self.hits.values())


def make(targets=(LOGS, GRAFANA, NAS, SKIPPED), period_s: float = 10.0):
    hosts = Hosts()
    inventory = FakeInventory(list(targets))
    client = httpx.AsyncClient(transport=httpx.MockTransport(hosts.handler))
    checker = ServiceChecker(inventory.load_targets, client, frozenset({"skipped"}), inventory.load_public_urls)
    source = ServicesSource(inventory, checker, period_s)  # type: ignore[arg-type]
    events: list[dict] = []
    source.attach(events.append)
    return source, inventory, hosts, events


async def started(source: ServicesSource) -> asyncio.Task:
    task = asyncio.create_task(source.run())
    await asyncio.sleep(0.02)
    return task


async def stop(task: asyncio.Task) -> None:
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


def by_name(source: ServicesSource) -> dict[str, dict]:
    return {r["name"]: r for r in source.data}


def data_events(events: list[dict]) -> list[dict]:
    return [e for e in events if e["type"] == "data"]


# ---- full rounds -------------------------------------------------------------------------


async def test_full_round_on_start_in_the_service_status_shape() -> None:
    source, _, hosts, events = make()
    task = await started(source)
    assert source.data == [
        {"name": "vm-a/logs", "url": "http://192.0.2.20:9428", "up": True, "code": 200, "error": "",
         "service_id": 1, "public_url": "https://logs.example.com"},
        {"name": "vm-a/grafana", "url": "http://192.0.2.20:3000", "up": True, "code": 200, "error": "",
         "service_id": 2, "public_url": None},
        {"name": "nas", "url": "https://192.0.2.50:443", "up": True, "code": 200, "error": "",
         "service_id": 3, "public_url": None},
    ]  # SERVICE_CHECK_EXCLUDE still applies
    assert hosts.total() == 3 and "192.0.2.60:80" not in hosts.hits
    assert data_events(events)[-1]["data"] == source.data
    status = [e for e in events if e["type"] == "status"][-1]
    assert status["state"] == "live" and status["periodS"] == 10.0 and status["updatedAt"]
    await stop(task)


async def test_full_round_every_period() -> None:
    source, _, hosts, _ = make(period_s=0.1)
    task = await started(source)
    await asyncio.sleep(0.23)
    assert source.rounds == 3 and hosts.hits["192.0.2.50:443"] == 3
    await stop(task)


async def test_full_round_when_the_target_list_changes_and_not_otherwise() -> None:
    source, inventory, _, _ = make()
    task = await started(source)
    source.on_inventory(inventory.parts)  # same targets
    await asyncio.sleep(0.02)
    assert source.rounds == 1
    inventory.parts.targets = [LOGS, NAS]
    source.on_inventory(inventory.parts)
    await asyncio.sleep(0.02)
    assert source.rounds == 2 and [r["name"] for r in source.data] == ["vm-a/logs", "nas"]
    await stop(task)


async def test_refresh_runs_a_full_round() -> None:
    source, _, hosts, _ = make()
    task = await started(source)
    source.refresh()
    await asyncio.sleep(0.02)
    assert source.rounds == 2 and hosts.total() == 6
    await stop(task)


async def test_publishes_only_when_something_changed() -> None:
    source, _, hosts, events = make()
    task = await started(source)
    assert len(data_events(events)) == 1
    source.refresh()
    await asyncio.sleep(0.02)
    assert len(data_events(events)) == 1  # same results: status only
    hosts.down = {"192.0.2.50:443"}
    source.refresh()
    await asyncio.sleep(0.02)
    assert len(data_events(events)) == 2 and by_name(source)["nas"]["up"] is False
    await stop(task)


async def test_no_targets_is_an_error_until_the_inventory_has_them() -> None:
    source, inventory, hosts, _ = make()
    inventory.parts.targets = None
    task = await started(source)
    assert source.state == "error" and source.error == "NetBox is unreachable." and hosts.total() == 0
    await stop(task)


async def test_checks_run_at_most_concurrency_at_a_time() -> None:
    running = peak = 0

    async def slow(request: httpx.Request) -> httpx.Response:
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1
        return httpx.Response(200)

    targets = [Target(f"t{i}", f"http://192.0.2.{i}:80", i) for i in range(1, 41)]
    inventory = FakeInventory(targets)
    client = httpx.AsyncClient(transport=httpx.MockTransport(slow))
    checker = ServiceChecker(inventory.load_targets, client, concurrency=16)
    results = await checker.check(targets, {})
    assert len(results) == 40 and peak == 16


# ---- ARP triggers ------------------------------------------------------------------------


async def test_arp_failed_marks_the_hosts_targets_down_without_a_check() -> None:
    source, _, hosts, _ = make()
    task = await started(source)
    before = hosts.total()
    source.on_arp("192.0.2.20", "failed")
    assert hosts.total() == before
    services = by_name(source)
    for name in ("vm-a/logs", "vm-a/grafana"):
        assert services[name]["up"] is False and services[name]["code"] == 0
        assert services[name]["error"] == "Host does not answer ARP"
    assert services["vm-a/logs"]["public_url"] == "https://logs.example.com"
    assert services["nas"]["up"] is True
    await stop(task)


async def test_arp_removal_checks_the_hosts_targets_once() -> None:
    source, _, hosts, _ = make()
    task = await started(source)
    hosts.down = {"192.0.2.20:9428"}
    source.on_arp("192.0.2.20", "removed")
    await asyncio.sleep(0.02)
    assert hosts.hits["192.0.2.20:9428"] == 1 + 2  # the round, then one check (with its retry)
    assert hosts.hits["192.0.2.20:3000"] == 2 and hosts.hits["192.0.2.50:443"] == 1
    assert by_name(source)["vm-a/logs"]["up"] is False
    await asyncio.sleep(0.1)
    assert hosts.hits["192.0.2.20:3000"] == 2  # once only
    await stop(task)


async def test_arp_back_checks_after_the_delays_and_a_newer_transition_replaces_them() -> None:
    source, _, hosts, _ = make()
    task = await started(source)
    source.on_arp("192.0.2.20", "failed")
    source.on_arp("192.0.2.20", "appeared")
    await asyncio.sleep(0.03)
    assert hosts.hits["192.0.2.20:3000"] == 2 and by_name(source)["vm-a/grafana"]["up"] is True  # at 0.02
    source.on_arp("192.0.2.20", "appeared")  # restarts the series
    await asyncio.sleep(0.1)
    assert hosts.hits["192.0.2.20:3000"] == 2 + 4
    assert hosts.hits["192.0.2.50:443"] == 1  # other hosts untouched
    await stop(task)


async def test_arp_failed_cancels_pending_checks() -> None:
    source, _, hosts, _ = make()
    task = await started(source)
    source.on_arp("192.0.2.20", "appeared")
    source.on_arp("192.0.2.20", "failed")
    await asyncio.sleep(0.1)
    assert hosts.hits["192.0.2.20:3000"] == 1
    assert by_name(source)["vm-a/grafana"]["error"] == "Host does not answer ARP"
    await stop(task)


async def test_triggers_are_ignored_while_stopped() -> None:
    source, _, hosts, events = make()
    source.on_arp("192.0.2.20", "failed")
    source.on_container("docker-1", "grafana", "running", "exited")
    await asyncio.sleep(0.03)
    assert hosts.total() == 0 and events == []


# ---- container triggers ------------------------------------------------------------------


async def test_container_stop_marks_its_targets_down_and_start_checks_later() -> None:
    source, _, hosts, _ = make()
    task = await started(source)
    source.on_container("docker-1", "grafana", "running", "exited")
    services = by_name(source)
    assert services["vm-a/grafana"]["up"] is False and services["vm-a/grafana"]["error"] == "Container is not running"
    assert services["vm-a/logs"]["up"] is True
    before = hosts.hits["192.0.2.20:3000"]
    source.on_container("docker-1", "grafana", "exited", "running")
    await asyncio.sleep(0.01)
    assert hosts.hits["192.0.2.20:3000"] == before  # not at once
    await asyncio.sleep(0.07)
    assert hosts.hits["192.0.2.20:3000"] == before + 3 and by_name(source)["vm-a/grafana"]["up"] is True
    assert hosts.hits["192.0.2.20:9428"] == 1
    await stop(task)


async def test_container_events_that_change_nothing_relevant_do_nothing() -> None:
    source, _, hosts, events = make()
    task = await started(source)
    published = len(events)
    source.on_container("docker-1", "unknown-container", "running", "exited")
    source.on_container("docker-1", "grafana", None, None)  # removed
    source.on_container("docker-1", "grafana", "running", "running")
    await asyncio.sleep(0.08)
    assert hosts.total() == 3 and len(events) == published
    await stop(task)


def test_container_entry_to_netbox_vm_mapping() -> None:
    assert container_vm_ids("docker-1", "victorialogs", INVENTORY) == [11]
    assert container_vm_ids("anything", "grafana", INVENTORY) == [12]  # one candidate: env not needed
    assert container_vm_ids("vm-a", "portainer_agent", INVENTORY) == [21]  # duplicate alias: host VM name
    assert container_vm_ids("vm-b", "portainer_agent", INVENTORY) == [22]  # host as a REST-style object
    assert container_vm_ids("docker-2", "portainer_agent", INVENTORY) == []  # duplicate, no host matches
    assert container_vm_ids("docker-1", "logs", INVENTORY) == []  # NetBox name is not the alias
    assert container_vm_ids("docker-1", "grafana", None) == []


# ---- /api/service-status -----------------------------------------------------------------


async def test_latest_runs_a_round_only_when_there_is_none_within_the_period() -> None:
    source, inventory, hosts, _ = make(period_s=0.1)
    first = await source.latest()
    assert [r["name"] for r in first] == ["vm-a/logs", "vm-a/grafana", "nas"] and hosts.total() == 3
    await source.latest()
    assert hosts.total() == 3 and inventory.cycles == 1
    await asyncio.sleep(0.12)
    await source.latest()
    assert hosts.total() == 6


async def test_latest_without_any_targets_raises() -> None:
    source, inventory, _, _ = make()
    inventory.parts.targets = None
    with pytest.raises(InventoryUnavailable, match="NetBox is unreachable."):
        await source.latest()


async def test_latest_is_served_from_the_running_source() -> None:
    source, _, hosts, _ = make()
    task = await started(source)
    assert await source.latest() == source.data and hosts.total() == 3
    await stop(task)


async def test_refresh_endpoint_and_health_cover_the_services_source() -> None:
    from app import main as main_module
    from app.hub import StreamHub

    source, _, hosts, _ = make()
    hub = StreamHub([source], grace_s=0.05)
    main_module.app.state.hub = hub
    main_module.app.state.services = source
    hub.subscribe()
    await asyncio.sleep(0.02)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main_module.app), base_url="http://api") as api:
        response = await api.post("/api/refresh")
        assert response.status_code == 202 and response.json() == {"refreshing": ["services"]}
        await asyncio.sleep(0.02)
        assert source.rounds == 2
        health = (await api.get("/api/health")).json()["stream"]["sources"]["services"]
        assert health["state"] == "live" and health["periodS"] == 10.0 and health["targets"] == 3
        statuses = (await api.get("/api/service-status")).json()
        assert statuses == source.data and hosts.total() == 6  # served from the source, no new round
    await hub.aclose()
