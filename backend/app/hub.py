"""One event stream for every page, fed by named sources that run only while someone listens.

The hub owns the subscriber queues. The first subscriber starts every source; when the last
one leaves, the sources keep running for a grace period and stop only if nobody came back
(a page reload therefore keeps the same upstream sessions). A source is any object that runs
until cancelled and publishes events through the hub; push-driven sources (a RouterOS
`listen`) and periodic pollers fit the same interface.
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterable
from typing import Any

log = logging.getLogger(__name__)

Event = dict[str, Any]
#: What a subscriber queue carries: the source name (the SSE `event:` field) and its payload.
Message = tuple[str, Event]
Publish = Callable[[Event], None]

QUEUE_SIZE = 500
GRACE_S = 10.0
#: Delay before a crashed source task is started again.
RESTART_S = 2.0


class Source(ABC):
    """A named producer of stream events.

    The hub calls `attach` once, then `run` in a task when the stream becomes active and
    cancels that task when it becomes idle, after which it calls `stopped`. `initial_events`
    is what a new (or recovering) subscriber needs to catch up; it must be cheap and
    synchronous.
    """

    #: The SSE event name of everything this source publishes.
    name: str

    def __init__(self) -> None:
        self._publish: Publish | None = None

    def attach(self, publish: Publish) -> None:
        self._publish = publish

    def publish(self, event: Event) -> None:
        if self._publish is not None:
            self._publish(event)

    @abstractmethod
    async def run(self) -> None:
        """Produce events until cancelled; handle (and retry on) upstream failures itself."""

    @abstractmethod
    def initial_events(self) -> list[Event]:
        """Events that bring a new subscriber up to date with this source."""

    def stopped(self) -> None:
        """Called after `run` was cancelled; drop session state here."""

    def health(self) -> dict[str, Any]:
        return {}


class StreamHub:
    def __init__(
        self,
        sources: Iterable[Source],
        grace_s: float = GRACE_S,
        queue_size: int = QUEUE_SIZE,
        restart_s: float = RESTART_S,
    ) -> None:
        self._sources: dict[str, Source] = {}
        for source in sources:
            if source.name in self._sources:
                raise ValueError(f"duplicate source name {source.name!r}")
            self._sources[source.name] = source
            source.attach(self._publisher(source.name))
        self._grace_s = grace_s
        self._restart_s = restart_s
        self._restart_timers: dict[str, asyncio.TimerHandle] = {}
        self._queue_size = queue_size
        self._subscribers: set[asyncio.Queue[Message]] = set()
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._stop_timer: asyncio.TimerHandle | None = None

    # ---- subscribers ----

    def subscribe(self) -> asyncio.Queue[Message]:
        queue: asyncio.Queue[Message] = asyncio.Queue(maxsize=self._queue_size)
        self._subscribers.add(queue)
        self._cancel_stop_timer()
        self._fill_initial(queue)
        self._start()
        return queue

    def unsubscribe(self, queue: asyncio.Queue[Message]) -> None:
        """Synchronous on purpose: it runs in the `finally` of a cancelled response stream."""
        self._subscribers.discard(queue)
        if not self._subscribers and self._tasks and self._stop_timer is None:
            self._stop_timer = asyncio.get_running_loop().call_later(self._grace_s, self._stop_if_idle)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    @property
    def running(self) -> bool:
        return bool(self._tasks)

    def health(self) -> dict[str, Any]:
        return {
            "subscribers": self.subscriber_count,
            "running": self.running,
            "stopping": self._stop_timer is not None,
            "sources": {
                name: {"running": self._is_running(name), **source.health()}
                for name, source in self._sources.items()
            },
        }

    async def aclose(self) -> None:
        self._cancel_stop_timer()
        tasks = list(self._tasks.values())
        self._stop()
        await asyncio.gather(*tasks, return_exceptions=True)

    # ---- fan-out ----

    def _publisher(self, name: str) -> Publish:
        def publish(event: Event) -> None:
            self._broadcast((name, event))

        return publish

    def _broadcast(self, message: Message) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # A stalled client: replace its backlog with every source's initial events.
                while not queue.empty():
                    queue.get_nowait()
                self._fill_initial(queue)

    def _fill_initial(self, queue: asyncio.Queue[Message]) -> None:
        for name, source in self._sources.items():
            for event in source.initial_events():
                queue.put_nowait((name, event))

    # ---- lifecycle ----

    def _is_running(self, name: str) -> bool:
        task = self._tasks.get(name)
        return task is not None and not task.done()

    def _start(self) -> None:
        for name in self._sources:
            task = self._tasks.get(name)
            if task is None or task.done():
                self._spawn(name)

    def _spawn(self, name: str) -> None:
        timer = self._restart_timers.pop(name, None)
        if timer is not None:
            timer.cancel()
        task = asyncio.create_task(self._sources[name].run(), name=f"source-{name}")
        task.add_done_callback(lambda done: self._on_task_done(name, done))
        self._tasks[name] = task

    def _on_task_done(self, name: str, task: asyncio.Task[None]) -> None:
        if task.cancelled() or task.exception() is None:
            return
        log.error("Stream source %s crashed; restarting in %.0f s", name, self._restart_s, exc_info=task.exception())
        if self._tasks.get(name) is not task:
            return  # already stopped or replaced
        self._sources[name].stopped()
        loop = asyncio.get_running_loop()
        self._restart_timers[name] = loop.call_later(self._restart_s, self._restart, name, task)

    def _restart(self, name: str, crashed: asyncio.Task[None]) -> None:
        self._restart_timers.pop(name, None)
        # Without subscribers (grace period) the next subscriber starts it again anyway.
        if self._tasks.get(name) is crashed and self._subscribers:
            self._spawn(name)

    def _cancel_stop_timer(self) -> None:
        if self._stop_timer is not None:
            self._stop_timer.cancel()
            self._stop_timer = None

    def _stop_if_idle(self) -> None:
        self._stop_timer = None
        if not self._subscribers:
            self._stop()

    def _stop(self) -> None:
        for timer in self._restart_timers.values():
            timer.cancel()
        self._restart_timers.clear()
        tasks, self._tasks = self._tasks, {}
        for task in tasks.values():
            task.cancel()
        for name in tasks:
            self._sources[name].stopped()
