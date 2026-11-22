import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import pytest
from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Response

from app.zigbee import (
    COMMANDS,
    EMPTY,
    ZigbeeSource,
    build_raw,
    build_zigbee,
    coordinator_from_services,
    websocket_url,
)

TOKEN = "ha-test-token-7f3a"  # invented; must never show up in any output

# Invented registries, in the shape Home Assistant returns them.
DEVICES = [
    {"id": "b1", "name": "Bridge", "name_by_user": None, "manufacturer": "Zigbee2MQTT", "model": "Bridge",
     "sw_version": "2.1.0", "via_device_id": None, "area_id": None},
    {"id": "d2", "name": "0x00158d0001", "name_by_user": "Porch sensor", "manufacturer": "Acme", "model": "PIR-1",
     "sw_version": None, "via_device_id": "b1", "area_id": "porch"},
    {"id": "d1", "name": "Attic plug", "name_by_user": None, "manufacturer": "Acme", "model": "PLUG-2",
     "sw_version": None, "via_device_id": "b1", "area_id": None},
    {"id": "d3", "name": "Empty", "name_by_user": "", "manufacturer": "Acme", "model": "X",
     "sw_version": None, "via_device_id": "b1", "area_id": "shed"},
    {"id": "d4", "name": "Half", "name_by_user": None, "manufacturer": "Acme", "model": "Y",
     "sw_version": None, "via_device_id": "b1", "area_id": "missing"},
    # Not behind the bridge: not Zigbee.
    {"id": "m1", "name": "Doorbell app", "name_by_user": None, "manufacturer": "Home-made", "model": "app",
     "sw_version": None, "via_device_id": None, "area_id": None},
]
ENTITIES = [
    {"entity_id": "sensor.bridge_state", "device_id": "b1"},
    {"entity_id": "binary_sensor.porch_motion", "device_id": "d2"},
    {"entity_id": "sensor.porch_battery", "device_id": "d2"},
    {"entity_id": "switch.attic_plug", "device_id": "d1"},
    {"entity_id": "sensor.half_temperature", "device_id": "d4"},
    {"entity_id": "sensor.half_humidity", "device_id": "d4"},
    {"entity_id": "sensor.half_disabled", "device_id": "d4"},  # disabled: no state
    {"entity_id": "sun.sun", "device_id": None},
    {"entity_id": "sensor.doorbell", "device_id": "m1"},
]
AREAS = [{"area_id": "porch", "name": "Porch"}, {"area_id": "shed", "name": "Shed"}]
STATES = [
    {"entity_id": "sensor.bridge_state", "state": "online"},
    {"entity_id": "binary_sensor.porch_motion", "state": "off"},
    {"entity_id": "sensor.porch_battery", "state": "unavailable"},
    {"entity_id": "switch.attic_plug", "state": "unavailable"},
    {"entity_id": "sensor.half_temperature", "state": "unavailable"},
    {"entity_id": "sensor.half_humidity", "state": "41"},
    {"entity_id": "sun.sun", "state": "below_horizon"},
    {"entity_id": "sensor.doorbell", "state": "idle"},
]
RESULTS = dict(zip(COMMANDS, (DEVICES, ENTITIES, AREAS, STATES), strict=True))
SERVICE = {"id": 9, "name": "zigbee-socket", "parent_object_type": "dcim.device", "parent": {"id": 19}}

server_log = logging.getLogger("test.ha-server")
server_log.setLevel(logging.INFO)  # the fake server must not log the auth frame either


class FakeHomeAssistant:
    """A Home Assistant WebSocket endpoint on localhost; `mode` picks a failure."""

    def __init__(self) -> None:
        self.mode = "ok"
        self.received: list[dict[str, Any]] = []
        self.paths: list[str] = []
        self.close_codes: list[int | None] = []
        self.url = ""

    def process_request(self, connection: ServerConnection, request: Any) -> Response | None:
        self.paths.append(request.path)
        if self.mode == "http401":
            return Response(401, "Unauthorized", Headers(), f"bad token {TOKEN}".encode())
        return None

    async def handler(self, ws: ServerConnection) -> None:
        await ws.send(json.dumps({"type": "auth_required", "ha_version": "2099.1.0"}))
        auth = json.loads(await ws.recv())
        self.received.append(auth)
        if self.mode == "bad_token" or auth.get("access_token") != TOKEN:
            await ws.send(json.dumps({"type": "auth_invalid", "message": f"Invalid access token {TOKEN}"}))
            return
        await ws.send(json.dumps({"type": "auth_ok", "ha_version": "2099.1.0"}))
        if self.mode == "close":
            return  # the server drops the connection right after auth
        async for raw in ws:
            message = json.loads(raw)
            self.received.append(message)
            if self.mode == "refuse":
                await ws.send(json.dumps({"id": message["id"], "type": "result", "success": False,
                                          "error": {"code": "unauthorized", "message": f"no {TOKEN}"}}))
                continue
            # An unrelated message first: the client must wait for its own result.
            await ws.send(json.dumps({"id": 999, "type": "event", "event": {}}))
            await ws.send(json.dumps({"id": message["id"], "type": "result", "success": True,
                                      "result": RESULTS[message["type"]]}))
        self.close_codes.append(ws.close_code)


@pytest.fixture
async def ha() -> AsyncIterator[FakeHomeAssistant]:
    fake = FakeHomeAssistant()
    async with serve(fake.handler, "127.0.0.1", 0, process_request=fake.process_request, logger=server_log) as server:
        port = server.sockets[0].getsockname()[1]
        fake.url = f"http://127.0.0.1:{port}"
        yield fake


def test_websocket_url_follows_the_scheme() -> None:
    assert websocket_url("http://ha.example:8123/") == "ws://ha.example:8123/api/websocket"
    assert websocket_url("https://ha.example") == "wss://ha.example/api/websocket"


def test_parses_the_registries_into_device_records() -> None:
    raw = {r["id"]: r for r in build_raw(DEVICES, ENTITIES, AREAS, STATES)}
    assert set(raw) == {"b1", "d1", "d2", "d3", "d4", "m1"}
    assert raw["d2"] == {"id": "d2", "name": "0x00158d0001", "name_by_user": "Porch sensor", "manufacturer": "Acme",
                         "model": "PIR-1", "sw_version": None, "via_device_id": "b1", "area": "Porch",
                         "entities": 2, "available": 1}
    assert (raw["d1"]["entities"], raw["d1"]["available"]) == (1, 0)
    assert (raw["d3"]["entities"], raw["d3"]["available"]) == (0, 0)
    assert (raw["d4"]["entities"], raw["d4"]["available"], raw["d4"]["area"]) == (3, 1, None)  # unknown area
    for bad in ({"a": 1}, [1, 2], None):
        with pytest.raises(Exception, match="unexpected device registry"):
            build_raw(bad, [], [], [])
    with pytest.raises(Exception, match="unexpected state list"):
        build_raw([], [], [], "x")


def test_selects_the_bridge_and_the_devices_behind_it_with_availability() -> None:
    raw = build_raw(DEVICES, ENTITIES, AREAS, STATES)
    data = build_zigbee(raw, "7")
    assert data["coordinator"] == {"deviceId": "7", "version": "2.1.0"}
    assert data["devices"] == [
        {"id": "d1", "name": "Attic plug", "manufacturer": "Acme", "model": "PLUG-2", "area": None, "available": False},
        {"id": "d3", "name": "Empty", "manufacturer": "Acme", "model": "X", "area": "Shed", "available": False},
        {"id": "d4", "name": "Half", "manufacturer": "Acme", "model": "Y", "area": None, "available": True},
        {"id": "d2", "name": "Porch sensor", "manufacturer": "Acme", "model": "PIR-1", "area": "Porch", "available": True},
    ]
    no_bridge = [r for r in raw if r["id"] != "b1"]
    assert build_zigbee(no_bridge, None) == {"coordinator": {"deviceId": None, "version": None}, "devices": []}


def test_coordinator_is_the_netbox_device_with_the_zigbee_socket_service() -> None:
    services = [
        {"id": 5, "name": "http", "parent_object_type": "dcim.device", "parent": {"id": 3}},
        SERVICE,
        {"id": 11, "name": "zigbee-socket", "parent_object_type": "virtualization.virtualmachine", "parent": {"id": 4}},
    ]
    assert coordinator_from_services(services) == "19"
    assert coordinator_from_services(services[:1]) is None


async def test_one_read_only_connection_publishes_the_snapshot(ha: FakeHomeAssistant) -> None:
    source = ZigbeeSource(ha.url, TOKEN)
    source.set_services([SERVICE])
    events: list[dict] = []
    source.attach(events.append)
    await source.cycle()
    assert ha.paths == ["/api/websocket"]
    assert ha.received[0] == {"type": "auth", "access_token": TOKEN}
    # Only the four read commands, nothing else: no call_service, no subscribe, no update.
    assert [(m["id"], m["type"]) for m in ha.received[1:]] == list(enumerate(COMMANDS, start=1))
    for _ in range(100):  # the server notices the close a moment after the cycle returns
        if ha.close_codes:
            break
        await asyncio.sleep(0.01)
    assert ha.close_codes == [1000]  # the client closed the connection normally at the end
    assert events[0]["type"] == "data" and events[0]["data"]["coordinator"] == {"deviceId": "19", "version": "2.1.0"}
    assert [d["id"] for d in events[0]["data"]["devices"]] == ["d1", "d3", "d4", "d2"]
    assert events[1]["state"] == "live" and events[1]["error"] is None
    await source.cycle()
    assert ha.paths == ["/api/websocket"] * 2  # a new short connection per cycle


async def test_source_is_off_without_config() -> None:
    async def connect(url: str):  # pragma: no cover - must not be called
        raise AssertionError("no connection without config")

    for url, token in (("", TOKEN), ("http://ha.example", "")):
        source = ZigbeeSource(url, token, connect)
        events: list[dict] = []
        source.attach(events.append)
        await source.cycle()
        assert events[0] == {"type": "data", "data": EMPTY}
        assert events[1]["state"] == "error"
        assert events[1]["error"] == "Zigbee: Home Assistant is not configured (HA_URL and HA_TOKEN)."


@pytest.mark.parametrize(
    ("mode", "error"),
    [
        ("bad_token", "Zigbee: Home Assistant rejected the token."),
        ("close", "Zigbee: Home Assistant closed the connection."),
        ("refuse", "Zigbee: Home Assistant refused config/device_registry/list (unauthorized)."),
        ("http401", "Zigbee: Home Assistant responded with HTTP 401."),
    ],
)
async def test_errors_are_prefixed_and_the_token_never_appears(
    ha: FakeHomeAssistant, mode: str, error: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    source = ZigbeeSource(ha.url, TOKEN)
    events: list[dict] = []
    source.attach(events.append)
    await source.cycle()  # a good cycle first: an error must replace the data with EMPTY
    assert events[0]["data"]["devices"]
    ha.mode = mode
    await source.cycle()
    assert [e["error"] for e in events if e["type"] == "status"][-1] == error
    assert events[-1]["state"] == "error"
    assert [e for e in events if e["type"] == "data"][-1]["data"] == EMPTY
    assert TOKEN not in json.dumps(events)
    assert TOKEN not in caplog.text
    assert TOKEN not in json.dumps(source.health())


async def test_unreachable_and_timeout_are_reported_without_the_token(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)

    async def refused(url: str):
        raise ConnectionRefusedError(f"connect failed for {TOKEN}")

    async def slow(url: str):
        raise TimeoutError

    for connect, error in ((refused, "Zigbee: Home Assistant is unreachable."),
                           (slow, "Zigbee: Home Assistant did not respond in time.")):
        source = ZigbeeSource("http://ha.example", TOKEN, connect)
        events: list[dict] = []
        source.attach(events.append)
        await source.cycle()
        assert events[-1]["error"] == error
        assert TOKEN not in json.dumps(events)
    assert TOKEN not in caplog.text


async def test_a_real_closed_port_is_unreachable() -> None:
    source = ZigbeeSource("http://127.0.0.1:9", TOKEN)
    events: list[dict] = []
    source.attach(events.append)
    await source.cycle()
    assert events[-1]["error"] == "Zigbee: Home Assistant is unreachable."


async def test_a_new_coordinator_triggers_a_cycle() -> None:
    source = ZigbeeSource("http://ha.example", TOKEN)
    seen: list[bool] = []
    source.refresh = lambda: seen.append(True)  # type: ignore[method-assign]
    source.set_services([SERVICE])
    source.set_services([SERVICE])
    source.set_services(None)
    assert seen == [True]
