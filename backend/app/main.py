"""HTTP API of the backend. Served behind the page's nginx under `/api/`."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from .arp import ArpHub
from .checks import ServiceChecker
from .config import Settings
from .netbox import NetBoxClient, fetch_mac_directory, fetch_targets
from .routeros import RouterOsConnection

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

KEEPALIVE_S = 15.0


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = Settings.from_env()
    netbox_http = httpx.AsyncClient()
    checks_http = httpx.AsyncClient(verify=False)
    netbox = NetBoxClient(settings, netbox_http)

    async def connect() -> RouterOsConnection:
        return await RouterOsConnection.open(
            settings.routeros_host,
            settings.routeros_port,
            settings.routeros_user,
            settings.routeros_password,
        )

    app.state.settings = settings
    app.state.arp = ArpHub(connect, lambda: fetch_mac_directory(netbox, settings.netbox_public_url))
    app.state.checks = ServiceChecker(lambda: fetch_targets(netbox), checks_http, settings.service_check_exclude)
    try:
        yield
    finally:
        await netbox_http.aclose()
        await checks_http.aclose()


app = FastAPI(title="lab-status-api", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.get("/api/health")
async def health() -> dict[str, object]:
    hub: ArpHub = app.state.arp
    return {"ok": True, "arp": {"state": hub.state, "subscribers": hub.subscriber_count}}


@app.get("/api/service-status")
async def service_status() -> list[dict[str, object]]:
    try:
        return await app.state.checks.run()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"NetBox is unreachable: {exc}") from exc


async def _arp_events(hub: ArpHub) -> AsyncIterator[str]:
    queue = hub.subscribe()
    try:
        yield "retry: 5000\n\n"
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), KEEPALIVE_S)
            except TimeoutError:
                yield ": keepalive\n\n"
                continue
            yield f"data: {json.dumps(event, separators=(',', ':'))}\n\n"
    finally:
        hub.unsubscribe(queue)


@app.get("/api/arp/stream")
async def arp_stream() -> StreamingResponse:
    return StreamingResponse(
        _arp_events(app.state.arp),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
