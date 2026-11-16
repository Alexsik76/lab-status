import asyncio
import json
from pathlib import Path

import httpx

from app.config import Settings
from app.hub import StreamHub
from app.proxmox import (
    ProxmoxClient,
    ProxmoxMetricsSource,
    ProxmoxResourcesSource,
    proxmox_sources,
)

FIXTURES = Path(__file__).resolve().parents[2] / "src" / "__fixtures__"
RESOURCES = json.loads((FIXTURES / "proxmoxResources.json").read_text())["data"]
RRD = json.loads((FIXTURES / "proxmoxRrd.json").read_text())["data"]
NODES = [r["node"] for r in RESOURCES if r["type"] == "node"]
SETTINGS = Settings(proxmox_url="https://pve.example:8006", proxmox_token="claude@pve!dash=secret")


class Upstream:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.failing_nodes: set[str] = set()
        self.resources_status = 200

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path == "/api2/json/cluster/resources":
            if self.resources_status != 200:
                return httpx.Response(self.resources_status)
            return httpx.Response(200, json={"data": RESOURCES})
        node = path.split("/")[4]
        if node in self.failing_nodes:
            return httpx.Response(595)
        return httpx.Response(200, json={"data": RRD})

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))


def test_sources_are_absent_when_proxmox_is_not_configured() -> None:
    assert proxmox_sources(Settings(), httpx.AsyncClient()) == []
    assert proxmox_sources(Settings(proxmox_url="https://pve.example:8006"), httpx.AsyncClient()) == []
    assert [s.name for s in proxmox_sources(SETTINGS, httpx.AsyncClient())] == ["proxmox", "metrics"]


async def test_resources_are_the_data_array_unchanged_with_the_token_header() -> None:
    upstream = Upstream()
    source = ProxmoxResourcesSource(ProxmoxClient(SETTINGS, upstream.client()))
    events: list[dict] = []
    source.attach(events.append)
    await source.cycle()
    assert events[0] == {"type": "data", "data": RESOURCES}
    request = upstream.requests[0]
    assert str(request.url) == "https://pve.example:8006/api2/json/cluster/resources"
    assert request.headers["Authorization"] == "PVEAPIToken=claude@pve!dash=secret"
    assert source.nodes == NODES


async def test_resources_failure_reports_a_readable_error() -> None:
    upstream = Upstream()
    upstream.resources_status = 502
    source = ProxmoxResourcesSource(ProxmoxClient(SETTINGS, upstream.client()))
    await source.cycle()
    assert source.state == "error" and source.error == "Proxmox responded with HTTP 502 Bad Gateway."


async def test_metrics_per_node_and_one_failing_node_yields_an_empty_list() -> None:
    upstream = Upstream()
    upstream.failing_nodes = {NODES[0]}
    api = ProxmoxClient(SETTINGS, upstream.client())
    resources = ProxmoxResourcesSource(api)
    metrics = ProxmoxMetricsSource(api, resources)
    events: list[dict] = []
    metrics.attach(events.append)

    await metrics.cycle()
    assert events == [] and metrics.cycles == 0  # no nodes known yet: skipped

    await resources.cycle()
    await metrics.cycle()
    assert events[0] == {"type": "data", "data": {NODES[0]: [], **{n: RRD for n in NODES[1:]}}}
    assert metrics.state == "live"
    rrd_requests = [r for r in upstream.requests if r.url.path.endswith("/rrddata")]
    assert {r.url.params["timeframe"] for r in rrd_requests} == {"hour"}
    assert {r.url.params["cf"] for r in rrd_requests} == {"AVERAGE"}


async def test_new_node_set_refreshes_the_metrics_at_once() -> None:
    upstream = Upstream()
    hub = StreamHub(proxmox_sources(SETTINGS, upstream.client()), grace_s=0.05)
    hub.subscribe()
    await asyncio.sleep(0.1)
    rrd = [r for r in upstream.requests if r.url.path.endswith("/rrddata")]
    assert len(rrd) == len(NODES)  # not waiting 60 s for the first graphs
    assert len([r for r in upstream.requests if r.url.path.endswith("/cluster/resources")]) == 1
    health = hub.health()["sources"]
    assert health["proxmox"]["state"] == "live" and health["proxmox"]["periodS"] == 15.0
    assert health["metrics"]["state"] == "live" and health["metrics"]["updatedAt"] is not None
    await hub.aclose()


async def test_only_a_new_node_set_refreshes_the_metrics_not_a_new_order() -> None:
    api = ProxmoxClient(SETTINGS, Upstream().client())
    source = ProxmoxResourcesSource(api)
    calls: list[int] = []
    source.on_nodes_changed.append(lambda: calls.append(1))
    answers = [RESOURCES, list(reversed(RESOURCES)), [r for r in RESOURCES if r.get("node") != NODES[0] or r["type"] != "node"]]

    async def cluster_resources():
        return answers.pop(0)

    api.cluster_resources = cluster_resources  # type: ignore[method-assign]
    await source.cycle()
    await source.cycle()  # same nodes, other order
    assert len(calls) == 1
    await source.cycle()  # a node disappeared
    assert len(calls) == 2 and NODES[0] not in source.nodes
