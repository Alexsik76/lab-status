"""HTTP checks of NetBox services, run on request (replaces the n8n `service-status` webhook)."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from .netbox import Target

TARGETS_TTL_S = 300
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


class ServiceChecker:
    def __init__(
        self,
        load_targets: Callable[[], Awaitable[list[Target]]],
        client: httpx.AsyncClient,
        exclude: frozenset[str] = frozenset(),
    ) -> None:
        self._load_targets = load_targets
        self._client = client
        self._exclude = exclude
        self._targets: list[Target] | None = None
        self._loaded_at = 0.0
        self._lock = asyncio.Lock()

    async def targets(self) -> list[Target]:
        async with self._lock:
            stale = time.monotonic() - self._loaded_at > TARGETS_TTL_S
            if self._targets is None or stale:
                try:
                    self._targets = await self._load_targets()
                    self._loaded_at = time.monotonic()
                except Exception:
                    if self._targets is None:
                        raise
                    # NetBox is unreachable: keep checking the last known list.
            return [t for t in self._targets if t.name not in self._exclude]

    async def run(self) -> list[dict[str, Any]]:
        targets = await self.targets()
        return list(await asyncio.gather(*(check_target(self._client, t) for t in targets)))
