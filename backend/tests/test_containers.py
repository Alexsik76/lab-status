import asyncio
import json
from datetime import UTC, datetime, timedelta

import httpx

from app.config import Settings
from app.containers import (
    ACTIONS,
    ContainersSource,
    PortainerClient,
    containers_sources,
)
from app.hub import StreamHub

SETTINGS = Settings(portainer_url="https://portainer.example:9443", portainer_token="ptr_readonly")
CLOSE = object()  # pushed on an event queue: the stream ends


def container(cid: str, name: str, state: str = "running", status: str = "Up 4 days") -> dict:
    return {"Id": cid, "Names": [f"/{name}"], "State": state, "Status": status, "Image": "x"}


class Env:
    def __init__(self, id_: int, name: str, containers: list[dict], type_: int = 1, status: int = 1) -> None:
        self.id, self.name, self.type, self.status = id_, name, type_, status
        self.containers = {c["Id"]: c for c in containers}
        self.events: asyncio.Queue = asyncio.Queue()
        self.down = False
        self.connects = 0


class FakePortainer:
    def __init__(self, envs: list[Env]) -> None:
        self.envs = {e.id: e for e in envs}
        self.requests: list[httpx.Request] = []
        self.list_down = False

    async def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.headers["X-API-Key"] == "ptr_readonly"
        parts = request.url.path.strip("/").split("/")  # api/endpoints[/id/docker/...]
        if parts == ["api", "endpoints"]:
            if self.list_down:
                raise httpx.ConnectError("down", request=request)
            return httpx.Response(200, json=[
                {"Id": e.id, "Name": e.name, "Type": e.type, "Status": e.status} for e in self.envs.values()
            ] + [{"Id": 99, "Name": "k8s", "Type": 5, "Status": 1}])
        env = self.envs[int(parts[2])]
        if env.down:
            raise httpx.ConnectError("down", request=request)
        if parts[4:] == ["containers", "json"]:
            assert request.url.params["all"] == "1"
            items = list(env.containers.values())
            if "filters" in request.url.params:
                ids = json.loads(request.url.params["filters"])["id"]
                items = [c for c in items if c["Id"] in ids]
            return httpx.Response(200, json=items)
        if parts[4:] == ["events"]:
            # Type only (an action filter leaves Portainer's buffered stream stuck), uncompressed.
            assert json.loads(request.url.params["filters"]) == {"type": ["container"]}
            assert request.headers["Accept-Encoding"] == "identity"
            env.connects += 1

            async def stream():
                while True:
                    item = await env.events.get()
                    if item is CLOSE:
                        return
                    yield (json.dumps(item) + "\n").encode()

            return httpx.Response(200, content=stream())
        raise AssertionError(f"unexpected {request.url}")

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))


def event(action: str, cid: str) -> dict:
    return {"Type": "container", "Action": action, "status": action, "id": cid, "Actor": {"ID": cid}}


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 16, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        self.now += timedelta(seconds=1)
        return self.now


def make(fake: FakePortainer, **kwargs) -> tuple[ContainersSource, list[dict]]:
    source = ContainersSource(PortainerClient(SETTINGS, fake.client()), clock=Clock(), **kwargs)
    events: list[dict] = []
    source.attach(events.append)
    return source, events


async def start(source: ContainersSource) -> asyncio.Task:
    task = asyncio.create_task(source.run())
    await asyncio.sleep(0.05)
    return task


async def stop(task: asyncio.Task) -> None:
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


def two_envs() -> FakePortainer:
    return FakePortainer([
        Env(3, "docker-1", [container("a1", "lab-status", status="Up 57 seconds"), container("a2", "n8n")]),
        Env(6, "docker-2", [container("b1", "frigate", status="Up 2 days (healthy)")], type_=2),
    ])


async def test_initial_list_of_every_docker_environment_in_the_webhook_shape() -> None:
    source, events = make(two_envs())
    task = await start(source)
    data = [e for e in events if e["type"] == "data"][-1]["data"]
    assert data == [
        {"env": "docker-1", "name": "lab-status", "state": "running", "status": "Up 57 seconds"},
        {"env": "docker-1", "name": "n8n", "state": "running", "status": "Up 4 days"},
        {"env": "docker-2", "name": "frigate", "state": "running", "status": "Up 2 days (healthy)"},
    ]
    status = [e for e in events if e["type"] == "status"][-1]
    assert status["state"] == "live" and status["error"] is None
    assert status["periodS"] == 300.0 and status["updatedAt"]
    health = source.health()["environments"]
    assert set(health) == {"docker-1", "docker-2"}  # the Kubernetes environment is skipped
    assert health["docker-1"] == {"state": "live", "error": None, "updatedAt": health["docker-1"]["updatedAt"],
                                  "containers": 2}
    await stop(task)


async def test_start_die_and_destroy_events_update_the_list() -> None:
    fake = two_envs()
    source, _events = make(fake)
    task = await start(source)
    env = fake.envs[3]

    env.containers["a2"] = container("a2", "n8n", "exited", "Exited (0) 1 second ago")
    await env.events.put(event("die", "a2"))
    await asyncio.sleep(0.02)
    assert {"env": "docker-1", "name": "n8n", "state": "exited", "status": "Exited (0) 1 second ago"} in source.data

    env.containers["a3"] = container("a3", "new-app", "running", "Up Less than a second")
    await env.events.put(event("start", "a3"))
    await asyncio.sleep(0.02)
    assert any(e["name"] == "new-app" for e in source.data)

    del env.containers["a3"]
    await env.events.put(event("destroy", "a3"))
    await asyncio.sleep(0.02)
    assert not any(e["name"] == "new-app" for e in source.data)

    # health_status carries a suffix ("health_status: healthy"); exec_* events are ignored.
    env.containers["a1"] = container("a1", "lab-status", status="Up 2 minutes (healthy)")
    await env.events.put(event("health_status: healthy", "a1"))
    await asyncio.sleep(0.02)
    requests = len(fake.requests)
    await env.events.put(event("exec_start: sh -c true", "a1"))
    await asyncio.sleep(0.02)
    assert len(fake.requests) == requests
    assert {"env": "docker-1", "name": "lab-status", "state": "running", "status": "Up 2 minutes (healthy)"} in source.data
    # Each event re-read only that container.
    filtered = [r for r in fake.requests if "filters" in r.url.params and r.url.path.endswith("/containers/json")]
    assert [json.loads(r.url.params["filters"])["id"] for r in filtered] == [["a2"], ["a3"], ["a3"], ["a1"]]
    await stop(task)


async def test_no_event_is_published_when_nothing_changed() -> None:
    fake = two_envs()
    source, events = make(fake)
    task = await start(source)
    data_events = len([e for e in events if e["type"] == "data"])
    await fake.envs[3].events.put(event("update", "a1"))  # re-read, same entry
    await asyncio.sleep(0.02)
    source.refresh()  # reconcile, same lists
    await asyncio.sleep(0.05)
    assert len([e for e in events if e["type"] == "data"]) == data_events
    await stop(task)


async def test_a_container_event_publishes_its_data_and_no_status_while_the_state_holds() -> None:
    fake = two_envs()
    source, events = make(fake, follow_up_s=(0.02, 0.04))
    task = await start(source)
    env = fake.envs[3]
    before = len(events)
    env.containers["a2"] = container("a2", "n8n", "exited", "Exited (0) 1 second ago")
    await env.events.put(event("die", "a2"))
    await asyncio.sleep(0.08)  # the event's re-read and both delayed re-reads, all unchanged after the first
    assert container_reads(fake, "a2") == 3
    assert [e["type"] for e in events[before:]] == ["data"]
    # The status still reports the state, and a new subscriber gets the latest time.
    assert source.health()["environments"]["docker-1"]["updatedAt"]
    assert source.initial_events()[0]["state"] == "live"
    await stop(task)


async def test_status_is_published_when_an_environment_fails_and_recovers() -> None:
    fake = two_envs()
    source, events = make(fake, backoff=(0.01, 0.01))
    task = await start(source)
    before = len(events)
    fake.envs[6].down = True
    await fake.envs[6].events.put(CLOSE)
    await asyncio.sleep(0.03)
    fake.envs[6].down = False
    await asyncio.sleep(0.05)
    statuses = [e for e in events[before:] if e["type"] == "status"]
    errors = [s["error"] for s in statuses]
    assert errors[0] == "docker-2: Portainer closed the Docker event stream."
    assert "docker-2: Portainer is unreachable." in errors and errors[-1] is None
    assert all(s["state"] == "live" for s in statuses)  # docker-1 stayed live
    await stop(task)


async def test_one_failing_environment_keeps_its_entries_and_the_other_keeps_streaming() -> None:
    fake = two_envs()
    delays: list[float] = []

    async def sleep(seconds: float) -> None:
        delays.append(seconds)
        await asyncio.sleep(0.01)

    source, _events = make(fake, sleep=sleep)
    task = await start(source)

    fake.envs[6].down = True
    await fake.envs[6].events.put(CLOSE)  # its stream drops, reconnects fail
    await asyncio.sleep(0.1)
    assert source.state == "live"
    assert source.error == "docker-2: Portainer is unreachable."
    assert {"env": "docker-2", "name": "frigate", "state": "running", "status": "Up 2 days (healthy)"} in source.data
    assert source.health()["environments"]["docker-2"]["state"] == "error"

    fake.envs[3].containers["a2"] = container("a2", "n8n", "exited", "Exited (137) 1 second ago")
    await fake.envs[3].events.put(event("die", "a2"))
    await asyncio.sleep(0.02)
    assert any(e["name"] == "n8n" and e["state"] == "exited" for e in source.data)

    # Backoff: 2 s doubling to 60 s.
    assert delays[:7] == [2.0, 4.0, 8.0, 16.0, 32.0, 60.0, 60.0]

    fake.envs[6].down = False
    await asyncio.sleep(0.05)
    assert source.error is None and source.health()["environments"]["docker-2"]["state"] == "live"
    assert fake.envs[6].connects == 2
    await stop(task)


async def test_backoff_resets_after_a_successful_reconnect() -> None:
    fake = two_envs()
    delays: list[float] = []

    async def sleep(seconds: float) -> None:
        delays.append(seconds)
        await asyncio.sleep(0.005)

    source, _ = make(fake, sleep=sleep)
    task = await start(source)
    env = fake.envs[3]
    env.down = True
    await env.events.put(CLOSE)
    await asyncio.sleep(0.03)
    env.down = False
    await asyncio.sleep(0.03)
    await env.events.put(CLOSE)  # drops again after a good session
    await asyncio.sleep(0.03)
    first_reset = delays.index(2.0, 1)
    assert delays[0] == 2.0 and delays[1] == 4.0 and first_reset > 1
    await stop(task)


async def test_all_environments_down_is_an_error() -> None:
    fake = two_envs()
    for env in fake.envs.values():
        env.down = True

    async def sleep(_: float) -> None:
        await asyncio.sleep(1)

    source, _events = make(fake, sleep=sleep)
    task = await start(source)
    assert source.state == "error"
    assert source.error == "docker-1: Portainer is unreachable.; docker-2: Portainer is unreachable."
    assert not source.has_data
    await stop(task)


async def test_reconcile_corrects_a_missed_event_and_refresh_triggers_it() -> None:
    fake = two_envs()
    source, _events = make(fake, period_s=0.2)
    task = await start(source)
    del fake.envs[3].containers["a2"]  # removed without an event reaching us
    fake.envs[6].containers["b2"] = container("b2", "label-studio")
    source.refresh()
    await asyncio.sleep(0.05)
    assert [e["name"] for e in source.data] == ["lab-status", "frigate", "label-studio"]
    assert source.reconciles == 2

    fake.envs[6].containers["b3"] = container("b3", "door-notify")
    await asyncio.sleep(0.25)  # the period
    assert any(e["name"] == "door-notify" for e in source.data) and source.reconciles >= 3
    await stop(task)


async def test_portainer_list_failure_is_reported_and_entries_stay() -> None:
    fake = two_envs()
    source, _ = make(fake)
    task = await start(source)
    fake.list_down = True
    source.refresh()
    await asyncio.sleep(0.05)
    assert source.state == "live" and source.error == "Portainer: Portainer is unreachable."
    assert len(source.data) == 3
    fake.list_down = False
    source.refresh()
    await asyncio.sleep(0.05)
    assert source.error is None
    await stop(task)


async def test_in_the_hub_initial_events_and_stop() -> None:
    fake = two_envs()
    source, _ = make(fake)
    hub = StreamHub([source], grace_s=0.01)
    hub.subscribe()
    await asyncio.sleep(0.05)
    late = hub.subscribe()
    items = [late.get_nowait() for _ in range(late.qsize())]
    assert [name for name, _ in items] == ["containers", "containers"]
    assert items[0][1]["type"] == "status" and items[1][1]["type"] == "data" and len(items[1][1]["data"]) == 3
    await hub.aclose()
    assert source.state == "idle" and source.data  # entries kept for the next subscriber
    assert all(env.state == "idle" for env in source.environments.values())


async def test_no_portainer_request_after_the_last_page_left_and_the_grace_period() -> None:
    fake = two_envs()
    source, _ = make(fake, period_s=0.02, follow_up_s=(0.5,))
    hub = StreamHub([source], grace_s=0.05)
    page = hub.subscribe()
    await asyncio.sleep(0.05)
    await fake.envs[3].events.put(event("start", "a1"))  # leaves a delayed re-read pending
    await asyncio.sleep(0.02)
    assert source.environments[3].follow_ups
    requests = len(fake.requests)
    await asyncio.sleep(0.05)
    assert len(fake.requests) > requests  # re-lists go on while the page is connected

    hub.unsubscribe(page)
    await asyncio.sleep(0.1)
    assert not hub.running
    assert all(env.task is None and not env.follow_ups for env in source.environments.values())
    requests = len(fake.requests)
    await asyncio.sleep(0.6)  # past the re-list period and the cancelled re-read
    assert len(fake.requests) == requests
    await hub.aclose()


def test_source_absent_when_portainer_is_not_configured() -> None:
    assert containers_sources(Settings(), httpx.AsyncClient()) == []
    assert containers_sources(Settings(portainer_url="https://p:9443"), httpx.AsyncClient()) == []
    assert [s.name for s in containers_sources(SETTINGS, httpx.AsyncClient())] == ["containers"]


async def test_post_refresh_reconciles_the_containers() -> None:
    from app import main as main_module

    fake = two_envs()
    source, _ = make(fake)
    hub = StreamHub([source], grace_s=0.05)
    main_module.app.state.hub = hub
    hub.subscribe()
    await asyncio.sleep(0.05)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main_module.app), base_url="http://api") as api:
        response = await api.post("/api/refresh")
        assert response.status_code == 202 and response.json() == {"refreshing": ["containers"]}
        await asyncio.sleep(0.05)
        assert source.reconciles == 2
        health = (await api.get("/api/health")).json()["stream"]["sources"]["containers"]
        assert health["state"] == "live" and set(health["environments"]) == {"docker-1", "docker-2"}
    await hub.aclose()


# ---- late events: client-side action filter and delayed re-reads ----------------------


def container_reads(fake: FakePortainer, cid: str) -> int:
    return sum(
        1 for r in fake.requests
        if r.url.path.endswith("/containers/json") and json.loads(r.url.params.get("filters", "{}")).get("id") == [cid]
    )


async def test_event_request_has_the_type_only_filter_and_no_compression() -> None:
    fake = two_envs()
    source, _ = make(fake)
    task = await start(source)
    streams = [r for r in fake.requests if r.url.path.endswith("/docker/events")]
    assert len(streams) == 2
    for request in streams:
        assert json.loads(request.url.params["filters"]) == {"type": ["container"]}
        assert request.headers["Accept-Encoding"] == "identity"
    await stop(task)


async def test_events_outside_the_actions_make_no_request() -> None:
    fake = two_envs()
    source, events = make(fake, follow_up_s=(0.01,))
    task = await start(source)
    before, published = len(fake.requests), len(events)
    for action in ("exec_create: sh -c true", "exec_start: sh -c true", "exec_die", "attach", "top"):
        await fake.envs[3].events.put(event(action, "a1"))
    await asyncio.sleep(0.05)
    assert len(fake.requests) == before and len(events) == published
    assert not fake.envs[3].events.qsize() and source.environments[3].follow_ups == {}
    assert "exec_start" not in ACTIONS
    await stop(task)


async def test_die_then_silence_still_yields_the_later_state() -> None:
    fake = two_envs()
    source, _ = make(fake, follow_up_s=(0.03, 0.08))
    task = await start(source)
    env = fake.envs[3]
    env.containers["a2"] = container("a2", "n8n", "exited", "Exited (0) Less than a second ago")
    await env.events.put(event("die", "a2"))
    await asyncio.sleep(0.01)
    assert {"env": "docker-1", "name": "n8n", "state": "exited", "status": "Exited (0) Less than a second ago"} in source.data
    # The restart completes, but its start event never reaches us (stuck in Portainer's buffer).
    env.containers["a2"] = container("a2", "n8n", "running", "Up 1 second")
    await asyncio.sleep(0.04)
    assert {"env": "docker-1", "name": "n8n", "state": "running", "status": "Up 1 second"} in source.data
    env.containers["a2"] = container("a2", "n8n", "running", "Up 2 seconds (healthy)")
    await asyncio.sleep(0.06)
    assert {"env": "docker-1", "name": "n8n", "state": "running", "status": "Up 2 seconds (healthy)"} in source.data
    assert container_reads(fake, "a2") == 3  # the event and the two delayed re-reads
    assert source.environments[3].follow_ups == {}
    await stop(task)


async def test_a_newer_event_replaces_the_pending_re_reads_of_that_container() -> None:
    fake = two_envs()
    source, _ = make(fake, follow_up_s=(0.05, 0.1))
    task = await start(source)
    env = fake.envs[3]
    for action in ("kill", "stop", "die", "start"):
        await env.events.put(event(action, "a2"))
    await env.events.put(event("start", "a1"))  # another container keeps its own re-reads
    await asyncio.sleep(0.02)
    assert set(source.environments[3].follow_ups) == {"a1", "a2"}
    await asyncio.sleep(0.15)
    assert container_reads(fake, "a2") == 4 + 2  # four events, then one chain of two re-reads
    assert container_reads(fake, "a1") == 1 + 2
    await stop(task)


async def test_pending_re_reads_are_cancelled_when_the_session_ends() -> None:
    fake = two_envs()

    async def sleep(_: float) -> None:
        await asyncio.sleep(1)

    source, _ = make(fake, sleep=sleep, follow_up_s=(0.05,))
    task = await start(source)
    env = fake.envs[3]
    await env.events.put(event("die", "a2"))
    await asyncio.sleep(0.01)
    pending = source.environments[3].follow_ups["a2"]
    await env.events.put(CLOSE)  # the stream ends: the session fails and waits to reconnect
    await asyncio.sleep(0.01)
    assert pending.cancelled() and source.environments[3].follow_ups == {}
    await asyncio.sleep(0.06)
    assert container_reads(fake, "a2") == 1
    await stop(task)


async def test_pending_re_reads_are_cancelled_when_the_source_stops() -> None:
    fake = two_envs()
    source, _ = make(fake, follow_up_s=(0.05,))
    task = await start(source)
    await fake.envs[3].events.put(event("die", "a2"))
    await asyncio.sleep(0.01)
    pending = source.environments[3].follow_ups["a2"]
    await stop(task)
    source.stopped()
    await asyncio.sleep(0)
    assert pending.cancelled() and source.environments[3].follow_ups == {}


async def test_a_failing_delayed_re_read_does_not_break_the_session() -> None:
    fake = two_envs()
    source, _ = make(fake, follow_up_s=(0.03,))
    task = await start(source)
    env = fake.envs[3]
    await env.events.put(event("die", "a2"))
    await asyncio.sleep(0.01)
    env.down = True
    await asyncio.sleep(0.04)  # the re-read fails and is only logged
    env.down = False
    assert source.health()["environments"]["docker-1"]["state"] == "live"
    env.containers["a2"] = container("a2", "n8n", "exited", "Exited (1) 1 second ago")
    await env.events.put(event("die", "a2"))
    await asyncio.sleep(0.01)
    assert any(e["name"] == "n8n" and e["state"] == "exited" for e in source.data)
    await stop(task)


# ---- state changes for the service checks (stage 5) --------------------------------------


async def test_state_changes_are_reported_but_not_the_initial_list() -> None:
    fake = two_envs()
    source, _ = make(fake, follow_up_s=())
    changes: list[tuple] = []
    source.on_change.append(lambda *args: changes.append(args))
    task = await start(source)
    assert changes == []
    env = fake.envs[3]
    env.containers["a2"] = container("a2", "n8n", "exited", "Exited (0) 1 second ago")
    await env.events.put(event("die", "a2"))
    await asyncio.sleep(0.02)
    env.containers["a2"] = container("a2", "n8n", "running", "Up 1 second")
    await env.events.put(event("health_status: healthy", "a2"))  # any re-read that sees a new state
    await asyncio.sleep(0.02)
    env.containers["a2"] = container("a2", "n8n", "running", "Up 2 seconds (healthy)")
    await env.events.put(event("health_status: healthy", "a2"))  # status text only: no change
    await asyncio.sleep(0.02)
    fake.envs[6].containers["b1"] = container("b1", "frigate", "exited", "Exited (1) 1 second ago")
    source.refresh()  # a missed event found by the reconcile
    await asyncio.sleep(0.05)
    assert changes == [
        ("docker-1", "n8n", "running", "exited"),
        ("docker-1", "n8n", "exited", "running"),
        ("docker-2", "frigate", "running", "exited"),
    ]
    await stop(task)
