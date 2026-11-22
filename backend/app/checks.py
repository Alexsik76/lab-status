"""HTTP checks of NetBox services (replaces the n8n `service-status` webhook).

Targets and public URLs come from the `inventory` source's cycle; the `services` source decides
when to check what."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlsplit

import httpx

from .netbox import Target
from .npm import PublicUrlMap

log = logging.getLogger(__name__)

CHECK_TIMEOUT_S = 3.0
RETRY_DELAY_S = 2.0
#: Checks running at the same time.
CONCURRENCY = 16


def describe_check_error(exc: httpx.HTTPError) -> str:
    """The page's message for a failed check: the kind of failure only. The exception text
    (which names the address, and carries the OS error) goes to the server log."""
    if isinstance(exc, httpx.TimeoutException):
        return "timed out"
    if isinstance(exc, httpx.ConnectError):
        return "connection failed"
    if isinstance(exc, httpx.RemoteProtocolError):
        return "invalid HTTP response"
    if isinstance(exc, httpx.NetworkError):
        return "network error"
    return f"request failed ({type(exc).__name__})"


async def check_target(client: httpx.AsyncClient, target: Target) -> dict[str, Any]:
    """One check with one retry; any answer below HTTP 500 counts as up."""
    error = ""
    for attempt in range(2):
        try:
            response = await client.get(target.url, timeout=CHECK_TIMEOUT_S, follow_redirects=False)
        except httpx.HTTPError as exc:
            error = describe_check_error(exc)
            if attempt == 1:
                log.info("Service check of %s failed: %s", target.name, str(exc) or type(exc).__name__)
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


def public_url_for(target: Target, public: PublicUrlMap) -> str | None:
    key = _ip_port(target.url)
    return public.get(key) if key else None


class ServiceChecker:
    def __init__(
        self,
        load_targets: Callable[[], Awaitable[list[Target]]],
        client: httpx.AsyncClient,
        exclude: frozenset[str] = frozenset(),
        public_urls: Callable[[], Awaitable[PublicUrlMap]] | None = None,
        concurrency: int = CONCURRENCY,
    ) -> None:
        self._load_targets = load_targets
        self._client = client
        self._exclude = exclude
        self._public_urls = public_urls
        self._semaphore = asyncio.Semaphore(concurrency)
        #: Checks started so far (each is one target, with its own retry).
        self.checks = 0

    def allowed(self, targets: list[Target]) -> list[Target]:
        """SERVICE_CHECK_EXCLUDE applied."""
        return [t for t in targets if t.name not in self._exclude]

    async def targets(self) -> list[Target]:
        return self.allowed(await self._load_targets())

    async def public_url_map(self) -> PublicUrlMap:
        return await self._public_urls() if self._public_urls else {}

    async def check(self, targets: list[Target], public: PublicUrlMap) -> list[dict[str, Any]]:
        """Checks the targets, at most `concurrency` at a time; results in target order."""

        async def one(target: Target) -> dict[str, Any]:
            async with self._semaphore:
                self.checks += 1
                result = await check_target(self._client, target)
            result["public_url"] = public_url_for(target, public)
            return result

        return list(await asyncio.gather(*(one(t) for t in targets)))

    async def run(self) -> list[dict[str, Any]]:
        """One round of every target (targets and public URLs loaded first)."""
        targets = await self.targets()
        return await self.check(targets, await self.public_url_map())
