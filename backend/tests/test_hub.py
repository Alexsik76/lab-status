import asyncio

from app.hub import Event, Source, StreamHub
from app.main import format_sse


class PushSource(Source):
    """Publishes whatever the test pushes; counts runs and stops."""

    def __init__(self, name: str = "push") -> None:
        super().__init__()
        self.name = name
        self.runs = 0
        self.stops = 0
        self.last: Event | None = None

    async def run(self) -> None:
        self.runs += 1
        self.publish({"type": "started", "run": self.runs})
        await asyncio.Event().wait()

    def push(self, event: Event) -> None:
        self.last = event
        self.publish(event)

    def initial_events(self) -> list[Event]:
        return [{"type": "snapshot", "last": self.last}]

    def stopped(self) -> None:
        self.stops += 1


class PollSource(Source):
    """A periodic poller fits the same interface: `run` is just a loop with a sleep."""

    name = "poll"

    def __init__(self, interval: float) -> None:
        super().__init__()
        self.interval = interval
        self.polls = 0

    async def run(self) -> None:
        while True:
            self.polls += 1
            self.publish({"type": "poll", "n": self.polls})
            await asyncio.sleep(self.interval)

    def initial_events(self) -> list[Event]:
        return [{"type": "poll", "n": self.polls}] if self.polls else []


def drain_now(queue: asyncio.Queue) -> list[tuple[str, Event]]:
    items = []
    while not queue.empty():
        items.append(queue.get_nowait())
    return items


async def test_sources_start_on_first_subscriber_only() -> None:
    source = PushSource()
    hub = StreamHub([source], grace_s=0.05)
    await asyncio.sleep(0.01)
    assert source.runs == 0 and not hub.running

    first = hub.subscribe()
    await asyncio.sleep(0.01)
    hub.subscribe()
    await asyncio.sleep(0.01)
    assert source.runs == 1 and hub.running and hub.subscriber_count == 2
    assert ("push", {"type": "started", "run": 1}) in drain_now(first)
    await hub.aclose()


async def test_new_subscriber_receives_initial_events_of_every_source() -> None:
    push, poll = PushSource(), PollSource(interval=10)
    hub = StreamHub([push, poll], grace_s=0.05)
    hub.subscribe()
    await asyncio.sleep(0.01)
    push.push({"type": "upsert", "id": 1})

    late = hub.subscribe()
    assert drain_now(late) == [
        ("push", {"type": "snapshot", "last": {"type": "upsert", "id": 1}}),
        ("poll", {"type": "poll", "n": 1}),
    ]
    push.push({"type": "upsert", "id": 2})
    assert drain_now(late) == [("push", {"type": "upsert", "id": 2})]
    await hub.aclose()


async def test_resubscribe_within_grace_keeps_the_running_sources() -> None:
    source = PushSource()
    hub = StreamHub([source], grace_s=0.1)
    queue = hub.subscribe()
    await asyncio.sleep(0.01)
    hub.unsubscribe(queue)
    assert hub.health()["stopping"] is True
    await asyncio.sleep(0.05)
    hub.subscribe()
    assert hub.health()["stopping"] is False
    await asyncio.sleep(0.15)
    assert source.runs == 1 and source.stops == 0 and hub.running
    await hub.aclose()


async def test_grace_expiry_stops_the_sources_and_next_subscriber_restarts_them() -> None:
    source, poll = PushSource(), PollSource(interval=0.01)
    hub = StreamHub([source, poll], grace_s=0.05)
    queue = hub.subscribe()
    await asyncio.sleep(0.01)
    hub.unsubscribe(queue)
    await asyncio.sleep(0.03)
    assert hub.running  # still within the grace period
    await asyncio.sleep(0.05)
    assert not hub.running and source.stops == 1
    polls = poll.polls
    await asyncio.sleep(0.05)
    assert poll.polls == polls  # a stopped poller does not poll

    hub.subscribe()
    await asyncio.sleep(0.01)
    assert source.runs == 2 and hub.running
    await hub.aclose()


async def test_stalled_subscriber_gets_initial_events_instead_of_its_backlog() -> None:
    push, poll = PushSource(), PollSource(interval=10)
    hub = StreamHub([push, poll], grace_s=0.05, queue_size=5)
    stalled = hub.subscribe()
    reader = hub.subscribe()
    await asyncio.sleep(0.01)
    drain_now(reader)
    for i in range(10):
        push.push({"type": "upsert", "id": i})
        drain_now(reader)  # this one keeps up

    # Each overflow replaced the backlog with every source's initial events; the last one
    # happened at id 6, and later events follow in order.
    assert drain_now(stalled) == [
        ("push", {"type": "snapshot", "last": {"type": "upsert", "id": 6}}),
        ("poll", {"type": "poll", "n": 1}),
        ("push", {"type": "upsert", "id": 7}),
        ("push", {"type": "upsert", "id": 8}),
        ("push", {"type": "upsert", "id": 9}),
    ]
    await hub.aclose()


async def test_health_reports_subscribers_and_sources() -> None:
    hub = StreamHub([PushSource()], grace_s=0.05)
    assert hub.health() == {
        "subscribers": 0, "running": False, "stopping": False, "sources": {"push": {"running": False}},
    }
    hub.subscribe()
    await asyncio.sleep(0.01)
    assert hub.health()["subscribers"] == 1 and hub.health()["sources"]["push"]["running"] is True
    await hub.aclose()


def test_duplicate_source_names_are_rejected() -> None:
    try:
        StreamHub([PushSource("a"), PushSource("a")])
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_sse_frames_name_the_source() -> None:
    assert format_sse(("arp", {"type": "remove", "id": "*2"})) == (
        'event: arp\ndata: {"type":"remove","id":"*2"}\n\n'
    )
