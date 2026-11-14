import json

import httpx
import pytest

from app import npm as npm_module
from app.checks import ServiceChecker
from app.config import Settings
from app.netbox import Target
from app.npm import NpmClient, PublicUrls, build_public_url_map, fetch_public_url_map

SETTINGS = Settings(npm_url="http://npm.example:81", npm_identity="admin@example.com", npm_secret="example")


def _host(id_, domain, forward_host, port, certificate_id=0, enabled=True):
    return {"id": id_, "domain_names": [domain, f"www.{domain}"], "forward_host": forward_host,
            "forward_port": port, "certificate_id": certificate_id, "enabled": enabled}


async def _resolve(name: str) -> str | None:
    return {"npm.example": "192.0.2.5", "app.lan": "192.0.2.30", "loop.lan": "127.0.0.1"}.get(name)


class FakeNpm:
    """NPM API double: issues numbered tokens and rejects every token but the current one."""

    def __init__(self, hosts, expires="2999-01-01T00:00:00.000Z"):
        self.hosts = hosts
        self.expires = expires
        self.logins = 0
        self.valid_token: str | None = None
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/api/tokens":
            assert request.method == "POST"
            assert json.loads(request.content) == {"identity": "admin@example.com", "secret": "example"}
            self.logins += 1
            self.valid_token = f"token-{self.logins}"
            return httpx.Response(200, json={"token": self.valid_token, "expires": self.expires})
        assert request.url.path == "/api/nginx/proxy-hosts"
        if request.headers.get("Authorization") != f"Bearer {self.valid_token}":
            return httpx.Response(401, json={"error": {"message": "Invalid token"}})
        return httpx.Response(200, json=self.hosts)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))


# ---- token flow ------------------------------------------------------------------------


async def test_token_is_requested_once_and_reused() -> None:
    fake = FakeNpm([_host(1, "logs.example.com", "192.0.2.20", 9428)])
    async with fake.client() as client:
        npm = NpmClient(SETTINGS, client)
        assert await npm.proxy_hosts() == fake.hosts
        assert await npm.proxy_hosts() == fake.hosts
    assert fake.logins == 1
    assert fake.requests[1].headers["Authorization"] == "Bearer token-1"


async def test_token_is_renewed_on_401() -> None:
    fake = FakeNpm([])
    async with fake.client() as client:
        npm = NpmClient(SETTINGS, client)
        await npm.proxy_hosts()
        fake.valid_token = "revoked-by-npm"  # e.g. NPM restarted with a new secret
        assert await npm.proxy_hosts() == []
    assert fake.logins == 2


async def test_expired_token_is_renewed_before_the_request() -> None:
    fake = FakeNpm([], expires="2000-01-01T00:00:00.000Z")
    async with fake.client() as client:
        npm = NpmClient(SETTINGS, client)
        await npm.proxy_hosts()
        await npm.proxy_hosts()
    assert fake.logins == 2
    # Renewed up front: each listing succeeded at the first attempt, no 401 retry.
    assert [r.url.path for r in fake.requests].count("/api/nginx/proxy-hosts") == 2


async def test_rejected_login_raises() -> None:
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401))) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await NpmClient(SETTINGS, client).proxy_hosts()


# ---- map building ----------------------------------------------------------------------


async def test_map_resolves_names_loopback_and_schemes() -> None:
    hosts = [
        _host(4, "logs.example.com", "192.0.2.20", 9428, certificate_id=3),  # https
        _host(5, "plain.example.com", "app.lan", 8080),  # name resolved, no certificate -> http
        _host(6, "admin.example.com", "127.0.0.1", 81, certificate_id=1),  # loopback -> NPM host
        _host(7, "self.example.com", "localhost", 82),  # localhost -> NPM host
        _host(8, "off.example.com", "192.0.2.21", 80, enabled=False),  # disabled: ignored
        _host(9, "gone.example.com", "missing.lan", 80),  # unresolvable: ignored
        _host(10, "v6.example.com", "2001:db8::1", 80),  # not IPv4: ignored
        _host(11, "loop.example.com", "loop.lan", 83),  # resolves to loopback: not mapped
    ]
    result = await build_public_url_map(hosts, "npm.example", _resolve)
    assert result == {
        ("192.0.2.20", 9428): "https://logs.example.com",
        ("192.0.2.30", 8080): "http://plain.example.com",
        ("192.0.2.5", 81): "https://admin.example.com",
        ("192.0.2.5", 82): "http://self.example.com",
    }


async def test_first_host_by_id_wins_for_the_same_target() -> None:
    hosts = [_host(9, "second.example.com", "192.0.2.20", 80), _host(2, "first.example.com", "app.lan", 80),
             _host(3, "other.example.com", "192.0.2.30", 80)]
    hosts[1]["forward_host"] = "192.0.2.20"
    result = await build_public_url_map(hosts, "npm.example", _resolve)
    assert result == {("192.0.2.20", 80): "http://first.example.com", ("192.0.2.30", 80): "http://other.example.com"}


async def test_fetch_uses_the_ipv4_of_the_npm_url_host() -> None:
    fake = FakeNpm([_host(1, "admin.example.com", "127.0.0.1", 81)])
    async with fake.client() as client:
        result = await fetch_public_url_map(NpmClient(SETTINGS, client), _resolve)
    assert result == {("192.0.2.5", 81): "http://admin.example.com"}


# ---- cache -----------------------------------------------------------------------------


async def test_public_urls_are_cached_and_survive_npm_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    async def load():
        nonlocal calls
        calls += 1
        if calls > 1:
            raise httpx.ConnectError("npm down")
        return {("192.0.2.20", 80): "https://logs.example.com"}

    urls = PublicUrls(load)
    assert await urls.get() == {("192.0.2.20", 80): "https://logs.example.com"}
    assert await urls.get() == {("192.0.2.20", 80): "https://logs.example.com"}
    assert calls == 1
    monkeypatch.setattr(npm_module, "PUBLIC_URLS_TTL_S", -1)
    assert await urls.get() == {("192.0.2.20", 80): "https://logs.example.com"}
    assert calls == 2


async def test_first_npm_failure_gives_an_empty_map() -> None:
    async def load():
        raise RuntimeError("bad response")

    assert await PublicUrls(load).get() == {}


def test_feature_is_off_unless_all_settings_are_set() -> None:
    assert SETTINGS.npm_enabled
    assert not Settings(npm_url="http://npm.example:81", npm_identity="admin@example.com").npm_enabled
    assert not Settings().npm_enabled


# ---- status output ---------------------------------------------------------------------


def _ok_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200)))


async def _targets() -> list[Target]:
    return [
        Target("logs", "http://192.0.2.20:9428", 1),
        Target("nas", "https://192.0.2.50:443", 2),
        Target("cups", "http://192.0.2.33:631", 3),
    ]


async def test_status_entries_carry_the_public_url() -> None:
    async def load():
        return {("192.0.2.20", 9428): "https://logs.example.com", ("192.0.2.50", 443): "https://nas.example.com"}

    async with _ok_client() as client:
        results = await ServiceChecker(_targets, client, public_urls=PublicUrls(load)).run()
    assert {r["name"]: r["public_url"] for r in results} == {
        "logs": "https://logs.example.com",
        "nas": "https://nas.example.com",
        "cups": None,
    }
    assert all(r["up"] for r in results)


async def test_status_entries_without_npm_have_null_public_url() -> None:
    async with _ok_client() as client:
        results = await ServiceChecker(_targets, client).run()
    assert [r["public_url"] for r in results] == [None, None, None]


async def test_npm_failure_does_not_fail_statuses() -> None:
    async def load():
        raise httpx.ConnectError("npm down")

    async with _ok_client() as client:
        results = await ServiceChecker(_targets, client, public_urls=PublicUrls(load)).run()
    assert len(results) == 3 and all(r["public_url"] is None for r in results)
