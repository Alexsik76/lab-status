import asyncio
from datetime import UTC, datetime, timedelta

from app.hub import StreamHub
from app.polling import NotReady, PollingSource


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 16, 12, 0, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        self.now += timedelta(seconds=1)
        return self.now


class ScriptedSource(PollingSource):
    """Each fetch takes the next result from `script` (an exception is raised); the last repeats."""

    def __init__(self, script: list, period_s: float = 10.0) -> None:
        super().__init__("poll", period_s, clock=Clock())
        self.script = list(script)
        self.fetches = 0

    async def fetch(self):
        self.fetches += 1
        result = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        if isinstance(result, BaseException):
            raise result
        return result


def collect(source: PollingSource) -> list[dict]:
    events: list[dict] = []
    source.attach(events.append)
    return events


async def test_publishes_data_only_when_it_changed() -> None:
    source = ScriptedSource([{"a": 1}, {"a": 1}, {"a": 2}])
    events = collect(source)
    await source.cycle()
    await source.cycle()
    await source.cycle()
    data = [e for e in events if e["type"] == "data"]
    assert data == [{"type": "data", "data": {"a": 1}}, {"type": "data", "data": {"a": 2}}]
    # Every successful cycle moves updatedAt, so each one reports its status.
    statuses = [e for e in events if e["type"] == "status"]
    assert [s["updatedAt"] for s in statuses] == [
        "2026-11-16T12:00:01Z", "2026-11-16T12:00:02Z", "2026-11-16T12:00:03Z",
    ]
    assert all(s["state"] == "live" and s["error"] is None and s["periodS"] == 10.0 for s in statuses)


async def test_failure_keeps_last_data_and_reports_the_error_then_recovery_clears_it() -> None:
    source = ScriptedSource([[1], RuntimeError("upstream down"), RuntimeError("upstream down"), [1]])
    events = collect(source)
    await source.cycle()
    good_at = source.health()["updatedAt"]
    events.clear()

    await source.cycle()
    assert events == [{"type": "status", "state": "error", "error": "upstream down",
                       "updatedAt": good_at, "periodS": 10.0}]
    assert source.data == [1]
    assert source.initial_events() == [events[0], {"type": "data", "data": [1]}]

    events.clear()
    await source.cycle()  # same error again: nothing new to say
    assert events == []

    await source.cycle()
    assert events == [{"type": "status", "state": "live", "error": None,
                       "updatedAt": "2026-11-16T12:00:02Z", "periodS": 10.0}]  # data unchanged: no data event
    assert source.health() == {"state": "live", "error": None, "updatedAt": "2026-11-16T12:00:02Z", "periodS": 10.0}


async def test_not_ready_skips_the_cycle_silently() -> None:
    source = ScriptedSource([NotReady()])
    events = collect(source)
    await source.cycle()
    assert events == [] and source.cycles == 0 and source.updated_at is None


async def test_runs_on_its_period_and_refresh_runs_a_cycle_at_once() -> None:
    source = ScriptedSource([[1]], period_s=0.2)
    events = collect(source)
    task = asyncio.create_task(source.run())
    await asyncio.sleep(0.05)
    assert source.fetches == 1
    assert events[0] == {"type": "status", "state": "connecting", "error": None, "updatedAt": None, "periodS": 0.2}

    source.refresh()
    await asyncio.sleep(0.01)
    assert source.fetches == 2  # without waiting for the period

    await asyncio.sleep(0.25)
    assert source.fetches == 3  # the period restarts after each cycle
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    source.stopped()
    source.refresh()  # stopped: no-op
    assert source.state == "idle" and source.data == [1]


async def test_two_subscribers_share_one_fetch_per_period() -> None:
    source = ScriptedSource([[1]], period_s=0.1)
    hub = StreamHub([source], grace_s=0.05)
    first, second = hub.subscribe(), hub.subscribe()
    await asyncio.sleep(0.25)
    assert source.fetches == 3
    for queue in (first, second):
        names = []
        while not queue.empty():
            names.append(queue.get_nowait())
        assert ("poll", {"type": "data", "data": [1]}) in names
    await hub.aclose()


async def test_new_subscriber_gets_status_and_last_data() -> None:
    source = ScriptedSource([{"x": 1}], period_s=10)
    hub = StreamHub([source], grace_s=0.05)
    hub.subscribe()
    await asyncio.sleep(0.01)
    late = hub.subscribe()
    items = [late.get_nowait() for _ in range(late.qsize())]
    assert items == [
        ("poll", {"type": "status", "state": "live", "error": None, "updatedAt": "2026-11-16T12:00:01Z", "periodS": 10}),
        ("poll", {"type": "data", "data": {"x": 1}}),
    ]
    await hub.aclose()
