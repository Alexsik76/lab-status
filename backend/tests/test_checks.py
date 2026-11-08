import httpx
import pytest

from app import checks
from app.checks import ServiceChecker
from app.netbox import Target


@pytest.fixture(autouse=True)
def no_retry_delay(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(checks, "RETRY_DELAY_S", 0)


def _client() -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.port == 1:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response({2: 200, 3: 302, 4: 503}[request.url.port])

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_results_match_the_webhook_shape() -> None:
    targets = [Target(f"svc{p}", f"http://192.0.2.1:{p}", p) for p in (1, 2, 3, 4)] + [
        Target("skipped", "http://192.0.2.1:2", 9)
    ]

    async def load() -> list[Target]:
        return targets

    async with _client() as client:
        results = await ServiceChecker(load, client, frozenset({"skipped"})).run()

    by_name = {r["name"]: r for r in results}
    assert set(by_name) == {"svc1", "svc2", "svc3", "svc4"}
    assert by_name["svc1"]["up"] is False and by_name["svc1"]["code"] == 0 and by_name["svc1"]["error"]
    assert (by_name["svc2"]["up"], by_name["svc2"]["code"]) == (True, 200)
    assert (by_name["svc3"]["up"], by_name["svc3"]["code"]) == (True, 302)
    assert (by_name["svc4"]["up"], by_name["svc4"]["code"]) == (False, 503)
    assert by_name["svc2"]["service_id"] == 2


async def test_last_known_targets_survive_netbox_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    async def load() -> list[Target]:
        nonlocal calls
        calls += 1
        if calls > 1:
            raise httpx.ConnectError("netbox down")
        return [Target("svc2", "http://192.0.2.1:2", 2)]

    async with _client() as client:
        checker = ServiceChecker(load, client)
        await checker.run()
        monkeypatch.setattr(checks, "TARGETS_TTL_S", -1)
        results = await checker.run()
    assert [r["name"] for r in results] == ["svc2"]
