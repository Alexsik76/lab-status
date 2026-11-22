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


async def test_a_failed_check_names_the_kind_of_failure_only() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.port == 1:
            raise httpx.ConnectError("[Errno 111] Connect call failed ('192.0.2.1', 1)", request=request)
        raise httpx.ReadTimeout("timed out reading from 192.0.2.1:5", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        refused = await checks.check_target(client, Target("svc1", "http://192.0.2.1:1", 1))
        slow = await checks.check_target(client, Target("svc5", "http://192.0.2.1:5", 5))
    assert refused["error"] == "connection failed"
    assert slow["error"] == "timed out"
