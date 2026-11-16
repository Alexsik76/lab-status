"""The `containers` source: Docker container states of every Portainer environment, pushed by
Docker events.

For each Docker environment that is up, the source lists its containers and then holds the
environment's Docker event stream open (`type=container`, only the actions that change a
container's state or its status text). Every such event re-reads that one container through
the list endpoint filtered by id (`containers/json?all=1&filters={"id":[...]}`): unlike
`/containers/{id}/json`, the list endpoint gives the human `Status` text ("Up 4 days
(healthy)") the page shows, and it costs one small request; an empty answer means the
container is gone (destroy). A full re-list of every environment runs every `period_s`
(reconcile, also on `refresh()`), which corrects anything a missed event left behind.

Environments are independent: one that fails keeps its last entries, reconnects with backoff
(2 s doubling to 60 s), and is reported as `"<env>: <error>"` in the source error, while the
others stay live. The payload is the whole list in the shape of the former n8n webhook,
`[{"env", "name", "state", "status"}]`, sorted by environment and name.
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

from .config import Settings
from .hub import Event, Source
from .polling import CONNECTING, ERROR, IDLE, LIVE, iso, utc_now

log = logging.getLogger(__name__)

Json = dict[str, Any]

REQUEST_TIMEOUT_S = 10.0
#: Portainer environment types served by the Docker API: local Docker, agent, edge agent.
DOCKER_TYPES = frozenset({1, 2, 4})
#: Container event actions that can change `State` or `Status` (health checks' exec_* are not).
ACTIONS = (
    "create", "start", "restart", "stop", "die", "kill", "oom", "pause", "unpause",
    "destroy", "rename", "update", "health_status",
)
BACKOFF_INITIAL_S = 2.0
BACKOFF_MAX_S = 60.0


class PortainerError(Exception):
    pass


def describe(exc: BaseException) -> str:
    if isinstance(exc, PortainerError):
        return str(exc)
    if isinstance(exc, httpx.TimeoutException):
        return "Portainer did not respond in time."
    if isinstance(exc, httpx.HTTPStatusError):
        r = exc.response
        return f"Portainer responded with HTTP {r.status_code} {r.reason_phrase}.".replace(" .", ".")
    if isinstance(exc, httpx.HTTPError):
        return "Portainer is unreachable."
    return f"Portainer returned an unexpected response ({type(exc).__name__}: {exc})."


class PortainerClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._base = settings.portainer_url
        self._headers = {"X-API-Key": settings.portainer_token, "Accept": "application/json"}
        self._client = client

    async def _get(self, path: str, params: dict[str, str] | None = None) -> Any:
        response = await self._client.get(
            f"{self._base}/api/{path}", params=params, headers=self._headers, timeout=REQUEST_TIMEOUT_S
        )
        response.raise_for_status()
        return response.json()

    async def endpoints(self) -> list[Json]:
        body = await self._get("endpoints")
        if not isinstance(body, list):
            raise PortainerError("Portainer returned an unexpected environment list.")
        return body

    async def containers(self, endpoint_id: int, container_id: str | None = None) -> list[Json]:
        params = {"all": "1"}
        if container_id is not None:
            params["filters"] = json.dumps({"id": [container_id]})
        body = await self._get(f"endpoints/{endpoint_id}/docker/containers/json", params)
        if not isinstance(body, list):
            raise PortainerError("Portainer returned an unexpected container list.")
        return body

    async def events(self, endpoint_id: int) -> AsyncIterator[Json]:
        """Docker container events, one JSON object per line, until the stream ends."""
        params = {"filters": json.dumps({"type": ["container"], "event": list(ACTIONS)})}
        timeout = httpx.Timeout(REQUEST_TIMEOUT_S, read=None)
        async with self._client.stream(
            "GET", f"{self._base}/api/endpoints/{endpoint_id}/docker/events",
            params=params, headers=self._headers, timeout=timeout,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                line = line.strip()
                if line:
                    try:
                        yield json.loads(line)
                    except ValueError:
                        log.warning("Ignoring a malformed Docker event line: %.100s", line)


def entry(env: str, container: Json) -> Json:
    names = container.get("Names") or []
    name = str(names[0]).lstrip("/") if names else str(container.get("Id", ""))[:12]
    return {"env": env, "name": name, "state": container.get("State", ""), "status": container.get("Status", "")}


@dataclass
class Environment:
    id: int
    name: str
    #: Container id -> entry.
    entries: dict[str, Json] = field(default_factory=dict)
    state: str = CONNECTING
    error: str | None = None
    updated_at: datetime | None = None
    task: asyncio.Task[None] | None = None

    def health(self) -> Json:
        return {"state": self.state, "error": self.error, "updatedAt": iso(self.updated_at),
                "containers": len(self.entries)}


class ContainersSource(Source):
    name = "containers"

    def __init__(
        self,
        client: PortainerClient,
        period_s: float = 300.0,
        backoff: tuple[float, float] = (BACKOFF_INITIAL_S, BACKOFF_MAX_S),
        clock: Callable[[], datetime] = utc_now,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        super().__init__()
        self._client = client
        self.period_s = period_s
        self._backoff = backoff
        self._clock = clock
        self._sleep = sleep
        self._wake = asyncio.Event()
        self._running = False
        self.environments: dict[int, Environment] = {}
        self.data: list[Json] = []
        self.has_data = False
        self.state = IDLE
        self.error: str | None = None
        #: Error of the environment list itself (Portainer down), kept apart from per-env ones.
        self._list_error: str | None = None
        self.updated_at: datetime | None = None
        self.reconciles = 0

    # ---- source interface ----

    async def run(self) -> None:
        self._running = True
        self._set_status(CONNECTING, None)
        try:
            async with asyncio.TaskGroup() as group:
                while True:
                    self._wake.clear()
                    await self.reconcile(group)
                    try:
                        await asyncio.wait_for(self._wake.wait(), self.period_s)
                    except TimeoutError:
                        pass
        finally:
            self._running = False

    def initial_events(self) -> list[Event]:
        events = [self._status_event()]
        if self.has_data:
            events.append({"type": "data", "data": self.data})
        return events

    def stopped(self) -> None:
        # Entries stay for a later subscriber (with their age); the sessions are gone.
        self._running = False
        for env in self.environments.values():
            env.task = None
            env.state, env.error = IDLE, None
        self._list_error = None
        self.state, self.error = IDLE, None

    def health(self) -> Json:
        return {
            "state": self.state, "error": self.error, "updatedAt": iso(self.updated_at), "periodS": self.period_s,
            "environments": {env.name: env.health() for env in self.environments.values()},
        }

    def refresh(self) -> None:
        """Reconcile now. No-op while the source is stopped."""
        if self._running:
            self._wake.set()

    # ---- reconcile ----

    async def reconcile(self, group: asyncio.TaskGroup | None = None) -> None:
        """Re-read the environment list, re-list every environment, and start the event
        sessions of environments that have none."""
        self.reconciles += 1
        try:
            endpoints = await self._client.endpoints()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._list_error = describe(exc)
            log.warning("Portainer environment list failed: %s", self._list_error)
            self._publish_status()
            return
        self._list_error = None
        for endpoint in endpoints:
            if endpoint.get("Type") not in DOCKER_TYPES or endpoint.get("Status") != 1:
                continue
            env_id = int(endpoint["Id"])
            env = self.environments.get(env_id)
            if env is None:
                env = self.environments[env_id] = Environment(env_id, str(endpoint.get("Name") or env_id))
            else:
                env.name = str(endpoint.get("Name") or env.name)
        # Environments whose session is following events; the others re-list when they reconnect.
        following = [e for e in self.environments.values() if e.state == LIVE and e.task and not e.task.done()]
        await asyncio.gather(*(self._relist(env) for env in following))
        if group is not None:
            for env in self.environments.values():
                if env.task is None or env.task.done():
                    env.task = group.create_task(self._session(env), name=f"containers-{env.name}")
        self._publish_status()

    async def _relist(self, env: Environment) -> bool:
        try:
            containers = await self._client.containers(env.id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._env_failed(env, exc)
            return False
        env.entries = {c["Id"]: entry(env.name, c) for c in containers if "Id" in c}
        self._env_read(env)
        return True

    # ---- per-environment session ----

    async def _session(self, env: Environment) -> None:
        """List, then follow the event stream; on failure keep the entries and retry with backoff."""
        initial, maximum = self._backoff
        delay = initial
        while True:
            try:
                if await self._relist(env):
                    delay = initial
                    async for event in self._client.events(env.id):
                        await self._on_event(env, event)
                    raise PortainerError("Portainer closed the Docker event stream.")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._env_failed(env, exc)
            await self._sleep(delay)
            delay = min(delay * 2, maximum)

    async def _on_event(self, env: Environment, event: Json) -> None:
        action = str(event.get("Action") or event.get("status") or "").split(":")[0]
        container_id = event.get("id") or (event.get("Actor") or {}).get("ID")
        if action not in ACTIONS or not container_id:
            return
        found = await self._client.containers(env.id, container_id)
        if found:
            env.entries[container_id] = entry(env.name, found[0])
        else:
            env.entries.pop(container_id, None)
        self._env_read(env)

    # ---- state ----

    def _env_read(self, env: Environment) -> None:
        env.state, env.error = LIVE, None
        env.updated_at = self.updated_at = self._clock()
        self._publish_data()
        self._publish_status(force=True)

    def _env_failed(self, env: Environment, exc: BaseException) -> None:
        message = describe(exc)
        if (env.state, env.error) != (ERROR, message):
            log.warning("Portainer environment %s: %s", env.name, message)
        env.state, env.error = ERROR, message
        self._publish_status()

    def _publish_data(self) -> None:
        entries = [e for env in self.environments.values() for e in env.entries.values()]
        entries.sort(key=lambda e: (e["env"], e["name"]))
        if not self.has_data or entries != self.data:
            self.data, self.has_data = entries, True
            self.publish({"type": "data", "data": entries})

    def _publish_status(self, force: bool = False) -> None:
        errors = [f"Portainer: {self._list_error}"] if self._list_error else []
        errors += [f"{env.name}: {env.error}" for env in self.environments.values() if env.error]
        error = "; ".join(errors) or None
        envs = list(self.environments.values())
        if any(env.state == LIVE for env in envs):
            state = LIVE
        elif errors:
            state = ERROR
        else:
            state = CONNECTING
        self._set_status(state, error, force)

    def _status_event(self) -> Event:
        return {"type": "status", "state": self.state, "error": self.error,
                "updatedAt": iso(self.updated_at), "periodS": self.period_s}

    def _set_status(self, state: str, error: str | None, force: bool = False) -> None:
        if not force and (state, error) == (self.state, self.error):
            return
        self.state, self.error = state, error
        self.publish(self._status_event())


def containers_sources(settings: Settings, client: httpx.AsyncClient) -> list[Source]:
    """The source, or none when Portainer is not configured."""
    if not settings.portainer_enabled:
        return []
    return [ContainersSource(PortainerClient(settings, client), settings.containers_period_s)]
