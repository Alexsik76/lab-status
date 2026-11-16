"""Proxmox VE reads for the page: cluster resources and per-node load graphs.

Two polling sources share one API client: `proxmox` (`cluster/resources`, the `data` array
unchanged) and `metrics` (`nodes/<node>/rrddata?timeframe=hour&cf=AVERAGE` for every node of
the latest cluster resources, as `{node: points}`).
"""

import asyncio
import logging
from typing import Any
from urllib.parse import quote

import httpx

from .config import Settings
from .polling import NotReady, PollingSource

log = logging.getLogger(__name__)

TIMEOUT_S = 10.0
Json = Any


class ProxmoxError(Exception):
    pass


class ProxmoxClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._base = settings.proxmox_url
        self._headers = {"Authorization": f"PVEAPIToken={settings.proxmox_token}", "Accept": "application/json"}
        self._client = client

    async def get_data(self, path: str, params: dict[str, str] | None = None) -> list[Json]:
        """GET `/api2/json/<path>` and return its `data` array; every failure is a ProxmoxError."""
        try:
            response = await self._client.get(
                f"{self._base}/api2/json/{path}", params=params, headers=self._headers, timeout=TIMEOUT_S
            )
        except httpx.TimeoutException as exc:
            raise ProxmoxError(f"Proxmox did not respond within {TIMEOUT_S:.0f} s.") from exc
        except httpx.HTTPError as exc:
            raise ProxmoxError("Proxmox is unreachable.") from exc
        if response.is_error:
            raise ProxmoxError(f"Proxmox responded with HTTP {response.status_code} {response.reason_phrase}.".replace(" .", "."))
        try:
            body = response.json()
        except ValueError as exc:
            raise ProxmoxError("Proxmox returned a response that is not valid JSON.") from exc
        if not isinstance(body, dict) or not isinstance(body.get("data"), list):
            raise ProxmoxError(f"Proxmox returned an unexpected {path} response.")
        return body["data"]

    async def cluster_resources(self) -> list[Json]:
        return await self.get_data("cluster/resources")

    async def node_rrddata(self, node: str) -> list[Json]:
        return await self.get_data(
            f"nodes/{quote(node, safe='')}/rrddata", {"timeframe": "hour", "cf": "AVERAGE"}
        )


def node_names(resources: list[Json]) -> list[str]:
    return [
        item["node"]
        for item in resources
        if isinstance(item, dict) and item.get("type") == "node" and isinstance(item.get("node"), str)
    ]


class ProxmoxResourcesSource(PollingSource):
    def __init__(self, client: ProxmoxClient, period_s: float = 15.0) -> None:
        super().__init__("proxmox", period_s)
        self._client = client
        #: Called when the set of nodes changes (the metrics source refreshes then).
        self.on_nodes_changed: list[Any] = []
        self.nodes: list[str] | None = None

    async def fetch(self) -> list[Json]:
        resources = await self._client.cluster_resources()
        nodes = node_names(resources)
        changed = self.nodes is None or set(nodes) != set(self.nodes)
        self.nodes = nodes
        if changed:  # Proxmox lists nodes in no stable order; only the set matters
            for callback in self.on_nodes_changed:
                callback()
        return resources


class ProxmoxMetricsSource(PollingSource):
    def __init__(self, client: ProxmoxClient, resources: ProxmoxResourcesSource, period_s: float = 60.0) -> None:
        super().__init__("metrics", period_s)
        self._client = client
        self._resources = resources
        resources.on_nodes_changed.append(self.refresh)

    async def fetch(self) -> dict[str, list[Json]]:
        nodes = self._resources.nodes
        if nodes is None:
            raise NotReady  # the first cluster resources will trigger a cycle
        points = await asyncio.gather(*(self._node(node) for node in nodes))
        return dict(zip(nodes, points, strict=True))

    async def _node(self, node: str) -> list[Json]:
        try:
            return await self._client.node_rrddata(node)
        except ProxmoxError as exc:
            # One node down (e.g. switched off) must not drop the others' graphs.
            log.info("Proxmox rrddata of node %s failed: %s", node, exc)
            return []


def proxmox_sources(settings: Settings, client: httpx.AsyncClient) -> list[PollingSource]:
    """Both sources, or none when Proxmox is not configured."""
    if not settings.proxmox_enabled:
        return []
    api = ProxmoxClient(settings, client)
    resources = ProxmoxResourcesSource(api, settings.proxmox_period_s)
    metrics = ProxmoxMetricsSource(api, resources, settings.proxmox_metrics_period_s)
    return [resources, metrics]
