"""Base for stream sources that poll an upstream system on a period.

A polling source runs `fetch()` every `period_s` while the hub runs it, publishes the result
only when it differs from the last one, keeps the last good data when a fetch fails (and
reports the error), and runs a cycle at once on `refresh()`. Next to its data it publishes a
status event whenever its state, error or `updatedAt` changes:

    {"type": "status", "state": ..., "error": ..., "updatedAt": ..., "periodS": ...}
    {"type": "data", "data": ...}

`updatedAt` is the time of the last successful fetch (ISO 8601, UTC); with `periodS` the page
can tell how fresh the data is. `state` describes the published data: `error` means the last
fetch produced none. A source whose fetch succeeded only in part reports `live` with a
non-null `error` naming what failed (see `cycle_warning`).
"""

import asyncio
import logging
import time
from abc import abstractmethod
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from .hub import Event, Source

log = logging.getLogger(__name__)

IDLE, CONNECTING, LIVE, ERROR = "idle", "connecting", "live", "error"


class NotReady(Exception):
    """Raised by `fetch` when a cycle has nothing to do yet (e.g. waits on another source).
    The cycle is skipped without touching state, data or `updatedAt`."""


def utc_now() -> datetime:
    return datetime.now(UTC)


def iso(moment: datetime | None) -> str | None:
    return moment.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z") if moment else None


class PollingSource(Source):
    def __init__(self, name: str, period_s: float, clock: Callable[[], datetime] = utc_now) -> None:
        super().__init__()
        self.name = name
        self.period_s = period_s
        self._clock = clock
        self._wake = asyncio.Event()
        self._running = False
        self.data: Any = None
        self.has_data = False
        self.state = IDLE
        self.error: str | None = None
        self.updated_at: datetime | None = None
        #: Completed cycles (successful or failed), for tests and health.
        self.cycles = 0
        #: `time.monotonic()` of the last completed cycle, successful or not.
        self.last_cycle_at: float | None = None
        self._lock = asyncio.Lock()

    @abstractmethod
    async def fetch(self) -> Any:
        """One upstream round trip; returns JSON-serialisable data or raises."""

    def describe_error(self, exc: Exception) -> str:
        """The message shown on the page for a failed fetch."""
        return str(exc) or type(exc).__name__

    def cycle_warning(self) -> str | None:
        """After a successful fetch: what part of it failed, if any (reported as `error`)."""
        return None

    # ---- source interface ----

    async def run(self) -> None:
        self._running = True
        self._set_status(CONNECTING, None)
        try:
            while True:
                self._wake.clear()
                await self.cycle()
                try:
                    await asyncio.wait_for(self._wake.wait(), self.period_s)
                except TimeoutError:
                    pass
        finally:
            self._running = False

    def initial_events(self) -> list[Event]:
        events = [self._status_event()]
        if self.has_data:
            events.append(self._data_event())
        return events

    def stopped(self) -> None:
        # The last data and its time stay: a later subscriber sees them with an honest age.
        self._running = False
        self.state, self.error = IDLE, None

    def health(self) -> dict[str, Any]:
        return {"state": self.state, "error": self.error, "updatedAt": iso(self.updated_at), "periodS": self.period_s}

    # ---- polling ----

    def refresh(self) -> None:
        """Run a cycle now (or right after the one in flight). No-op while the source is stopped."""
        if self._running:
            self._wake.set()

    async def ensure_fresh(self) -> None:
        """For readers without a subscription: run a cycle unless one completed within the
        period (waiting for one in flight). Works whether or not the hub runs the source."""
        async with self._lock:
            if self.last_cycle_at is None or time.monotonic() - self.last_cycle_at > self.period_s:
                await self._cycle()

    async def cycle(self) -> None:
        async with self._lock:
            await self._cycle()

    async def _cycle(self) -> None:
        try:
            data = await self.fetch()
        except NotReady:
            return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._completed()
            message = self.describe_error(exc)
            log.warning("Source %s: fetch failed: %s", self.name, message)
            self._set_status(ERROR, message)
            return
        self._completed()
        self.updated_at = self._clock()
        if not self.has_data or data != self.data:
            self.data, self.has_data = data, True
            self.publish(self._data_event())
        warning = self.cycle_warning()
        if warning:
            log.warning("Source %s: partial failure: %s", self.name, warning)
        self._set_status(LIVE, warning, force=True)

    def _completed(self) -> None:
        self.cycles += 1
        self.last_cycle_at = time.monotonic()

    def _status_event(self) -> Event:
        return {
            "type": "status",
            "state": self.state,
            "error": self.error,
            "updatedAt": iso(self.updated_at),
            "periodS": self.period_s,
        }

    def _data_event(self) -> Event:
        return {"type": "data", "data": self.data}

    def _set_status(self, state: str, error: str | None, force: bool = False) -> None:
        if not force and (state, error) == (self.state, self.error):
            return
        self.state, self.error = state, error
        self.publish(self._status_event())
