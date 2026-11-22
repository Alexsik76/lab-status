import asyncio
import json
from pathlib import Path

import httpx
import pytest

from app import checks
from app import main as main_module
from app.checks import ServiceChecker
from app.config import Settings
from app.hub import StreamHub
from app.inventory import INVENTORY_QUERY, InventorySource, InventoryUnavailable
from app.netbox import NetBoxClient, Target
from app.npm import NpmClient
from app.services import ServicesSource

GRAPHQL = json.loads((Path(__file__).resolve().parents[2] / "src" / "__fixtures__" / "netbox.json").read_text())
SETTINGS = Settings(
    netbox_url="http://netbox.example", netbox_token="nb-token",
    npm_url="http://npm.example:81", npm_identity="admin@example.com", npm_secret="example",
)
DEVICES = [{"id": 1, "name": "srv-a", "status": {"value": "active"}, "role": {"name": "Server"}, "description": "",
            "primary_ip4": {"address": "192.0.2.10/24"}, "custom_fields": {}}]
VMS = [{"id": 10, "name": "vm-a", "status": {"value": "active"}, "role": None, "description": "",
        "primary_ip4": {"address": "192.0.2.20/24"}, "custom_fields": {"host": None}}]
SERVICES = [{"id": 100, "name": "logs", "ports": [9428], "custom_fields": {"scheme": {"value": "http"}, "check": True},
             "parent_object_type": "virtualization.virtualmachine", "parent": {"id": 10, "name": "vm-a"},
             "ipaddresses": []}]
MACS = [{"mac_address": "02:00:00:00:00:aa", "assigned_object_type": "dcim.interface",
         "assigned_object": {"name": "eth0", "device": {"id": 1, "name": "srv-a"}}}]
PROXY_HOSTS = [{"id": 1, "domain_names": ["logs.example.com"], "forward_host": "192.0.2.20", "forward_port": 9428,
                "certificate_id": 1, "enabled": True}]
IFACES = [{"id": 501, "name": "ether1", "device": {"id": 1, "name": "srv-a"}, "type": {"value": "1000base-t"},
           "speed": None, "mode": None, "untagged_vlan": None, "tagged_vlans": [], "mgmt_only": False},
          {"id": 502, "name": "eth0", "device": {"id": 2, "name": "srv-b"}, "type": {"value": "1000base-t"},
           "speed": None, "mode": None, "untagged_vlan": None, "tagged_vlans": [], "mgmt_only": False}]
CABLES = [{"id": 900, "type": "cat6", "status": {"value": "connected"},
           "a_terminations": [{"object_type": "dcim.interface", "object": IFACES[0]}],
           "b_terminations": [{"object_type": "dcim.interface", "object": IFACES[1]}]}]
VLANS = [{"vid": 10, "name": "trust"}]
TOPOLOGY = {
    "vlans": [{"vid": 10, "name": "trust"}],
    "ports": [{"id": "501", "deviceId": "1", "name": "ether1", "order": 0, "type": "1000base-t", "speedKbps": None,
               "mode": None, "untagged": None, "tagged": [], "mgmtOnly": False},
              {"id": "502", "deviceId": "2", "name": "eth0", "order": 0, "type": "1000base-t", "speedKbps": None,
               "mode": None, "untagged": None, "tagged": [], "mgmtOnly": False}],
    "cables": [{"id": "900", "type": "cat6", "a": "501", "b": "502"}],
}
REST = {
    "/api/dcim/devices/": DEVICES,
    "/api/dcim/cables/": CABLES,
    "/api/dcim/interfaces/": IFACES,
    "/api/ipam/vlans/": VLANS,
    "/api/virtualization/virtual-machines/": VMS,
    "/api/ipam/services/": SERVICES,
    "/api/dcim/mac-addresses/": MACS,
}


class Upstream:
    """NetBox (GraphQL + REST) and NPM doubles; `down` holds the paths that fail."""

    def __init__(self) -> None:
        self.down: set[str] = set()
        self.requests: list[str] = []
        self.macs = MACS

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append(path)
        host = request.url.host
        if host in self.down or path in self.down:
            raise httpx.ConnectError("down", request=request)
        if host == "npm.example":
            if path == "/api/tokens":
                return httpx.Response(200, json={"token": "t", "expires": "2999-01-01T00:00:00.000Z"})
            return httpx.Response(200, json=PROXY_HOSTS)
        assert request.headers["Authorization"] == "Token nb-token"
        if path == "/graphql/":
            assert json.loads(request.content) == {"query": INVENTORY_QUERY}
            return httpx.Response(200, json=GRAPHQL)
        results = self.macs if path == "/api/dcim/mac-addresses/" else REST[path]
        return httpx.Response(200, json={"results": results, "next": None})

    def source(self, period_s: float = 300.0) -> InventorySource:
        client = httpx.AsyncClient(transport=httpx.MockTransport(self.handler))

        async def resolve(name: str) -> str | None:
            return "192.0.2.5"

        return InventorySource(
            NetBoxClient(SETTINGS, client), NpmClient(SETTINGS, client), "https://netbox.example", period_s, resolve
        )


def collect(source: InventorySource) -> list[dict]:
    events: list[dict] = []
    source.attach(events.append)
    return events


async def test_one_cycle_feeds_inventory_targets_mac_directory_and_public_urls() -> None:
    upstream = Upstream()
    source = upstream.source()
    seen_macs: list[dict] = []
    source.on_macs_changed.append(seen_macs.append)
    events = collect(source)

    await source.cycle()

    # The GraphQL data object unchanged, with the topology beside its lists.
    assert events[0] == {"type": "data", "data": {**GRAPHQL["data"], "topology": TOPOLOGY}}
    assert events[1]["state"] == "live" and events[1]["error"] is None and events[1]["periodS"] == 300.0
    assert source.parts.targets == [Target("vm-a/logs", "http://192.0.2.20:9428", 100)]
    assert source.parts.public_urls == {("192.0.2.20", 9428): "https://logs.example.com"}
    assert source.parts.macs["02:00:00:00:00:AA"].name == "srv-a"
    assert seen_macs == [source.parts.macs]
    assert source.parts.device_ids == {"srv-a": "1"}  # for the Wi-Fi source
    # Each data set is read once per cycle, even when two parts need it.
    netbox_reads = [p for p in upstream.requests if not p.startswith("/api/tokens") and p != "/api/nginx/proxy-hosts"]
    assert sorted(netbox_reads) == sorted(["/graphql/", *REST])

    await source.cycle()  # same MAC directory: no callback
    assert len(seen_macs) == 1


async def test_partial_failure_keeps_the_old_part_reports_it_and_still_publishes() -> None:
    upstream = Upstream()
    source = upstream.source()
    await source.cycle()
    old_urls, old_targets = source.parts.public_urls, source.parts.targets
    events = collect(source)

    upstream.down = {"npm.example", "/api/ipam/services/"}
    await source.cycle()
    assert source.parts.public_urls == old_urls and source.parts.targets == old_targets
    status = events[-1]
    assert status["type"] == "status" and status["state"] == "live"
    assert status["error"] == "NetBox is unreachable. Nginx Proxy Manager is unreachable."
    assert source.health()["updatedAt"] == status["updatedAt"]  # the page's inventory was refreshed

    upstream.down = set()
    await source.cycle()
    assert events[-1]["state"] == "live" and events[-1]["error"] is None


async def test_failed_page_inventory_is_an_error_and_keeps_the_last_payload() -> None:
    upstream = Upstream()
    source = upstream.source()
    await source.cycle()
    good_at = source.health()["updatedAt"]
    events = collect(source)

    upstream.down = {"netbox.example"}
    await source.cycle()
    assert events == [{"type": "status", "state": "error", "error": "NetBox is unreachable.",
                       "updatedAt": good_at, "periodS": 300.0}]
    assert source.data == {**GRAPHQL["data"], "topology": TOPOLOGY} and source.parts.targets is not None


async def test_failed_topology_read_keeps_the_previous_topology_and_still_publishes() -> None:
    upstream = Upstream()
    source = upstream.source()
    await source.cycle()
    events = collect(source)

    upstream.down = {"/api/dcim/cables/"}
    await source.cycle()
    assert source.parts.topology == TOPOLOGY and source.data["topology"] == TOPOLOGY
    status = events[-1]
    assert status["type"] == "status" and status["state"] == "live"
    assert status["error"] == "Topology: NetBox is unreachable."
    assert source.parts.errors == {"topology": "NetBox is unreachable."}

    upstream.down = {"/api/ipam/vlans/", "npm.example"}  # summary order: topology before public_urls
    await source.cycle()
    assert events[-1]["error"] == "Topology: NetBox is unreachable. Nginx Proxy Manager is unreachable."
    assert list(source.parts.errors) == ["topology", "public_urls"]

    upstream.down = {"/api/ipam/services/", "/api/dcim/interfaces/"}  # same message, still named
    await source.cycle()
    assert events[-1]["error"] == "NetBox is unreachable. Topology: NetBox is unreachable."


async def test_topology_is_null_until_it_first_loads() -> None:
    upstream = Upstream()
    upstream.down = {"/api/dcim/interfaces/"}
    source = upstream.source()
    events = collect(source)
    await source.cycle()
    assert events[0] == {"type": "data", "data": {**GRAPHQL["data"], "topology": None}}
    assert events[1]["state"] == "live" and events[1]["error"] == "Topology: NetBox is unreachable."


async def test_graphql_errors_are_reported() -> None:
    upstream = Upstream()
    original = upstream.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/graphql/":
            return httpx.Response(200, json={"errors": [{"message": "bad field"}]})
        return original(request)

    upstream.handler = handler  # type: ignore[method-assign]
    source = upstream.source()
    await source.cycle()
    assert source.state == "error" and source.error == "NetBox rejected the query: bad field"


async def test_mac_directory_change_is_handed_on() -> None:
    upstream = Upstream()
    source = upstream.source()
    seen: list[dict] = []
    source.on_macs_changed.append(seen.append)
    await source.cycle()
    upstream.macs = [{**MACS[0], "mac_address": "02:00:00:00:00:bb"}]
    await source.cycle()
    assert [list(d) for d in seen] == [["02:00:00:00:00:AA"], ["02:00:00:00:00:BB"]]


# ---- readers without a subscription -------------------------------------------------


async def test_targets_without_a_subscriber_run_a_cycle_only_when_stale() -> None:
    upstream = Upstream()
    source = upstream.source(period_s=0.1)
    assert await source.load_targets() == [Target("vm-a/logs", "http://192.0.2.20:9428", 100)]
    await source.load_targets()
    await source.load_public_urls()
    assert source.cycles == 1  # within the period: no new NetBox reads
    await asyncio.sleep(0.15)
    await source.load_targets()
    assert source.cycles == 2


async def test_last_known_targets_survive_netbox_failure() -> None:
    upstream = Upstream()
    source = upstream.source(period_s=0)
    await source.load_targets()
    upstream.down = {"netbox.example"}
    assert [t.name for t in await source.load_targets()] == ["vm-a/logs"]
    assert source.cycles == 2


async def test_no_targets_ever_loaded_is_unavailable() -> None:
    upstream = Upstream()
    upstream.down = {"netbox.example"}
    with pytest.raises(InventoryUnavailable, match="NetBox is unreachable."):
        await upstream.source().load_targets()


async def test_first_npm_failure_gives_an_empty_map_and_statuses_still_work(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(checks, "RETRY_DELAY_S", 0)
    upstream = Upstream()
    upstream.down = {"npm.example"}
    source = upstream.source()
    assert await source.load_public_urls() == {}
    ok = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    results = await ServiceChecker(source.load_targets, ok, public_urls=source.load_public_urls).run()
    assert [(r["name"], r["up"], r["public_url"]) for r in results] == [("vm-a/logs", True, None)]


# ---- HTTP endpoints -------------------------------------------------------------------


def _api(source: InventorySource) -> httpx.AsyncClient:
    ok = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    main_module.app.state.hub = StreamHub([source], grace_s=0.05)
    # /api/service-status reads the services source, which checks with this checker.
    checker = ServiceChecker(source.load_targets, ok, public_urls=source.load_public_urls)
    main_module.app.state.services = ServicesSource(source, checker)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=main_module.app), base_url="http://api")


async def test_post_refresh_triggers_a_cycle_at_once() -> None:
    source = Upstream().source()
    async with _api(source) as api:
        hub: StreamHub = main_module.app.state.hub
        hub.subscribe()
        await asyncio.sleep(0.05)
        assert source.cycles == 1
        response = await api.post("/api/refresh")
        assert response.status_code == 202 and response.json() == {"refreshing": ["inventory"]}
        await asyncio.sleep(0.05)
        assert source.cycles == 2
        assert (await api.get("/api/refresh")).status_code == 405
        await hub.aclose()


async def test_service_status_without_a_subscriber(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(checks, "RETRY_DELAY_S", 0)
    upstream = Upstream()
    source = upstream.source()
    async with _api(source) as api:
        response = await api.get("/api/service-status")
        assert response.status_code == 200
        assert [(r["name"], r["public_url"]) for r in response.json()] == [("vm-a/logs", "https://logs.example.com")]
        assert source.cycles == 1 and not main_module.app.state.hub.running
        health = (await api.get("/api/health")).json()["stream"]["sources"]["inventory"]
        assert health["state"] == "live" and health["periodS"] == 300.0 and health["updatedAt"]


async def test_service_status_is_502_when_netbox_was_never_reached() -> None:
    upstream = Upstream()
    upstream.down = {"netbox.example"}
    async with _api(upstream.source()) as api:
        response = await api.get("/api/service-status")
        assert response.status_code == 502 and response.json()["detail"] == "NetBox is unreachable."
