"""HTTP checks of NetBox services, run on request (replaces the n8n `service-status` webhook).

Targets and public URLs come from the `inventory` source's cycle."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlsplit

import httpx

from .netbox import Target
from .npm import PublicUrlMap

CHECK_TIMEOUT_S = 3.0
RETRY_DELAY_S = 2.0


async def check_target(client: httpx.AsyncClient, target: Target) -> dict[str, Any]:
    """One check with one retry; any answer below HTTP 500 counts as up."""
    error = ""
    for attempt in range(2):
        try:
            response = await client.get(target.url, timeout=CHECK_TIMEOUT_S, follow_redirects=False)
        except httpx.HTTPError as exc:
            error = str(exc) or type(exc).__name__
            if attempt == 0:
                await asyncio.sleep(RETRY_DELAY_S)
            continue
        return {
            "name": target.name,
            "url": target.url,
            "up": response.status_code < 500,
            "code": response.status_code,
            "error": "",
            "service_id": target.service_id,
        }
    return {
        "name": target.name,
        "url": target.url,
        "up": False,
        "code": 0,
        "error": error,
        "service_id": target.service_id,
    }


def _ip_port(url: str) -> tuple[str, int] | None:
    parts = urlsplit(url)
    if not parts.hostname:
        return None
    return parts.hostname, parts.port or (443 if parts.scheme == "https" else 80)


class ServiceChecker:
    def __init__(
        self,
        load_targets: Callable[[], Awaitable[list[Target]]],
        client: httpx.AsyncClient,
        exclude: frozenset[str] = frozenset(),
        public_urls: Callable[[], Awaitable[PublicUrlMap]] | None = None,
    ) -> None:
        self._load_targets = load_targets
        self._client = client
        self._exclude = exclude
        self._public_urls = public_urls

    async def targets(self) -> list[Target]:
        return [t for t in await self._load_targets() if t.name not in self._exclude]

    async def _public_url_map(self) -> PublicUrlMap:
        return await self._public_urls() if self._public_urls else {}

    async def run(self) -> list[dict[str, Any]]:
        targets = await self.targets()
        public, *results = await asyncio.gather(
            self._public_url_map(), *(check_target(self._client, t) for t in targets)
        )
        for target, result in zip(targets, results):
            key = _ip_port(target.url)
            result["public_url"] = public.get(key) if key else None
        return results
