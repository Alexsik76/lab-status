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
from .hub import Message, StreamHub
from .netbox import NetBoxClient, fetch_mac_directory, fetch_targets
from .npm import NpmClient, PublicUrls, fetch_public_url_map
from .routeros import RouterOsConnection

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

KEEPALIVE_S = 15.0


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = Settings.from_env()
    netbox_http = httpx.AsyncClient()
    checks_http = httpx.AsyncClient(verify=False)
    netbox = NetBoxClient(settings, netbox_http)
    npm_http = httpx.AsyncClient()
    public_urls = None
    if settings.npm_enabled:
        npm = NpmClient(settings, npm_http)
        public_urls = PublicUrls(lambda: fetch_public_url_map(npm))

    async def connect() -> RouterOsConnection:
        return await RouterOsConnection.open(
            settings.routeros_host,
            settings.routeros_port,
            settings.routeros_user,
            settings.routeros_password,
        )

    app.state.settings = settings
    arp = ArpSource(connect, lambda: fetch_mac_directory(netbox, settings.netbox_public_url))
    app.state.hub = StreamHub([arp], grace_s=settings.stream_grace_s)
    app.state.checks = ServiceChecker(
        lambda: fetch_targets(netbox), checks_http, settings.service_check_exclude, public_urls
    )
    try:
        yield
    finally:
        await app.state.hub.aclose()
        await netbox_http.aclose()
        await checks_http.aclose()
        await npm_http.aclose()


app = FastAPI(title="lab-status-api", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.get("/api/health")
async def health() -> dict[str, object]:
    hub: StreamHub = app.state.hub
    return {"ok": True, "stream": hub.health()}


@app.get("/api/service-status")
async def service_status() -> list[dict[str, object]]:
    try:
        return await app.state.checks.run()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"NetBox is unreachable: {exc}") from exc


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
