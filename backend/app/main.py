"""HTTP API of the backend. Served behind the page's nginx under `/api/`."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from .arp import ArpSource
from .checks import ServiceChecker
from .config import Settings
from .containers import ContainersSource, containers_sources
from .hub import Message, StreamHub
from .inventory import InventorySource, InventoryUnavailable
from .netbox import NetBoxClient
from .npm import NpmClient
from .polling import PollingSource
from .proxmox import proxmox_sources
from .routeros import RouterOsConnection
from .services import ServicesSource
from .wifi import WifiSource
from .zigbee import ZigbeeSource

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

KEEPALIVE_S = 15.0


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = Settings.from_env()
    netbox_http = httpx.AsyncClient()
    checks_http = httpx.AsyncClient(verify=False)
    netbox = NetBoxClient(settings, netbox_http)
    npm_http = httpx.AsyncClient()
    proxmox_http = httpx.AsyncClient(verify=False)
    portainer_http = httpx.AsyncClient(verify=False)
    npm = NpmClient(settings, npm_http) if settings.npm_enabled else None

    async def connect() -> RouterOsConnection:
        return await RouterOsConnection.open(
            settings.routeros_host,
            settings.routeros_port,
            settings.routeros_user,
            settings.routeros_password,
        )

    app.state.settings = settings
    arp = ArpSource(connect)
    inventory = InventorySource(netbox, npm, settings.netbox_public_url, settings.inventory_period_s)
    inventory.on_macs_changed.append(arp.set_macs)
    wifi = WifiSource(connect, arp.hints)
    inventory.on_macs_changed.append(wifi.set_macs)
    inventory.on_cycle.append(lambda parts: wifi.set_device_ids(parts.device_ids))
    ha_http = httpx.AsyncClient()
    zigbee = ZigbeeSource(settings.ha_url, settings.ha_token, ha_http)
    inventory.on_cycle.append(lambda parts: zigbee.set_services(parts.services))
    checker = ServiceChecker(
        inventory.load_targets, checks_http, settings.service_check_exclude, inventory.load_public_urls
    )
    services = ServicesSource(inventory, checker, settings.services_period_s)
    inventory.on_cycle.append(services.on_inventory)
    arp.on_transition.append(services.on_arp)
    containers = containers_sources(settings, portainer_http)
    for source in containers:
        source.on_change.append(services.on_container)
    app.state.services = services
    app.state.hub = StreamHub(
        [arp, inventory, services, wifi, zigbee, *proxmox_sources(settings, proxmox_http), *containers],
        grace_s=settings.stream_grace_s,
    )
    try:
        yield
    finally:
        await app.state.hub.aclose()
        await netbox_http.aclose()
        await checks_http.aclose()
        await npm_http.aclose()
        await proxmox_http.aclose()
        await portainer_http.aclose()
        await ha_http.aclose()


app = FastAPI(title="lab-status-api", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.get("/api/health")
async def health() -> dict[str, object]:
    hub: StreamHub = app.state.hub
    return {"ok": True, "stream": hub.health()}


@app.get("/api/service-status")
async def service_status() -> list[dict[str, object]]:
    """The `services` source's latest list; a round runs first when it has none younger than
    its period (no page subscribed). The page itself reads the stream."""
    try:
        return await app.state.services.latest()
    except InventoryUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/refresh", status_code=202)
async def refresh() -> dict[str, object]:
    """Starts a cycle of every polling source, a container reconcile and a full round of service
    checks at once (the sources currently running)."""
    hub: StreamHub = app.state.hub
    refreshable = [s for s in hub.sources if isinstance(s, PollingSource | ContainersSource | ServicesSource)]
    for source in refreshable:
        source.refresh()
    names = [source.name for source in refreshable]
    return {"refreshing": names}


def format_sse(message: Message) -> str:
    name, event = message
    return f"event: {name}\ndata: {json.dumps(event, separators=(',', ':'))}\n\n"


async def _stream_events(hub: StreamHub) -> AsyncIterator[str]:
    queue = hub.subscribe()
    try:
        yield "retry: 5000\n\n"
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), KEEPALIVE_S)
            except TimeoutError:
                yield ": keepalive\n\n"
                continue
            yield format_sse(message)
    finally:
        hub.unsubscribe(queue)


@app.get("/api/stream")
async def stream() -> StreamingResponse:
    """The page's single Server-Sent Events channel; the `event:` field names the source."""
    return StreamingResponse(
        _stream_events(app.state.hub),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
