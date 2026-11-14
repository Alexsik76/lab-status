"""Nginx Proxy Manager reads: public (reverse-proxy) URLs of services checked at `ip:port`."""

import asyncio
import ipaddress
import logging
import socket
import time
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

import httpx

from .config import Settings

Json = dict[str, Any]
#: (IPv4, port) -> public URL, e.g. `("192.0.2.20", 9428) -> "https://logs.example.com"`.
PublicUrlMap = dict[tuple[str, int], str]
Resolver = Callable[[str], Awaitable[str | None]]

log = logging.getLogger(__name__)

PUBLIC_URLS_TTL_S = 300
NPM_TIMEOUT_S = 10.0
#: A token is renewed this long before NPM says it expires.
TOKEN_MARGIN_S = 60.0


class NpmClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.base = settings.npm_url
        self._credentials = {"identity": settings.npm_identity, "secret": settings.npm_secret}
        self._client = client
        self._token: str | None = None
        self._expires_at: float | None = None  # time.time() of expiry, when NPM reports it

    async def _login(self) -> str:
        response = await self._client.post(
            f"{self.base}/api/tokens", json=self._credentials, timeout=NPM_TIMEOUT_S
        )
        response.raise_for_status()
        body = response.json()
        self._token = body["token"]
        self._expires_at = _parse_expiry(body.get("expires"))
        return self._token

    def _token_valid(self) -> bool:
        if self._token is None:
            return False
        return self._expires_at is None or time.time() < self._expires_at - TOKEN_MARGIN_S

    async def _get(self, path: str) -> Any:
        token = self._token if self._token_valid() else await self._login()
        for attempt in range(2):
            response = await self._client.get(
                f"{self.base}/api/{path}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                timeout=NPM_TIMEOUT_S,
            )
            if response.status_code == 401 and attempt == 0:
                token = await self._login()
                continue
            response.raise_for_status()
            return response.json()
        raise AssertionError("unreachable")

    async def proxy_hosts(self) -> list[Json]:
        return await self._get("nginx/proxy-hosts")


def _parse_expiry(value: Any) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value).timestamp()
    except ValueError:
        return None


async def resolve_ipv4(name: str) -> str | None:
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(name, None, family=socket.AF_INET)
    except OSError:
        return None
    return infos[0][4][0] if infos else None


def _is_loopback(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


async def _to_ipv4(host: str, resolve: Resolver) -> str | None:
    """IP literals are kept as they are (IPv4 only); names are resolved."""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return await resolve(host)
    return str(ip) if ip.version == 4 else None


async def build_public_url_map(hosts: list[Json], npm_host: str, resolve: Resolver = resolve_ipv4) -> PublicUrlMap:
    """Enabled proxy hosts by forward target. A loopback forward host is the NPM host itself.

    Several hosts forwarding to the same target: the one with the lowest id wins.
    """
    npm_ip: str | None = None
    npm_ip_known = False
    result: PublicUrlMap = {}
    for host in sorted(hosts, key=lambda h: h.get("id") or 0):
        domains = host.get("domain_names") or []
        forward_host = str(host.get("forward_host") or "").strip()
        port = host.get("forward_port")
        if not host.get("enabled") or not domains or not forward_host or not isinstance(port, int):
            continue
        if _is_loopback(forward_host):
            if not npm_ip_known:
                npm_ip, npm_ip_known = await _to_ipv4(npm_host, resolve), True
            ip = npm_ip
        else:
            ip = await _to_ipv4(forward_host, resolve)
            if ip is not None and ipaddress.ip_address(ip).is_loopback:
                ip = None
        if ip is None or (ip, port) in result:
            continue
        scheme = "https" if host.get("certificate_id") else "http"
        result[(ip, port)] = f"{scheme}://{domains[0]}"
    return result


async def fetch_public_url_map(npm: NpmClient, resolve: Resolver = resolve_ipv4) -> PublicUrlMap:
    npm_host = urlsplit(npm.base).hostname or ""
    return await build_public_url_map(await npm.proxy_hosts(), npm_host, resolve)


class PublicUrls:
    """Lazily loaded, cached map; an NPM failure keeps the last good map (or an empty one)."""

    def __init__(self, load: Callable[[], Awaitable[PublicUrlMap]]) -> None:
        self._load = load
        self._map: PublicUrlMap = {}
        self._loaded_at: float | None = None
        self._lock = asyncio.Lock()

    async def get(self) -> PublicUrlMap:
        async with self._lock:
            if self._loaded_at is None or time.monotonic() - self._loaded_at > PUBLIC_URLS_TTL_S:
                try:
                    self._map = await self._load()
                except Exception as exc:  # statuses must never fail because of NPM
                    log.warning("Nginx Proxy Manager is unavailable, keeping %d public URLs: %s", len(self._map), exc)
                # A failed attempt also waits for the next period, so a dead NPM adds no delay per request.
                self._loaded_at = time.monotonic()
            return self._map
