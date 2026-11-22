import json
import logging

import httpx
import pytest

from app.zigbee import EMPTY, TEMPLATE, ZigbeeSource, build_zigbee, coordinator_from_services, parse_template_result

TOKEN = "ha-test-token-7f3a"  # invented; must never show up in any output

BRIDGE = {"id": "b1", "name": "Bridge", "name_by_user": None, "manufacturer": "Zigbee2MQTT", "model": "Bridge",
          "sw_version": "2.1.0", "via_device_id": None, "area": None, "entities": 4, "available": 4}
RAW = [
    BRIDGE,
    {"id": "d2", "name": "0x00158d0001", "name_by_user": "Porch sensor", "manufacturer": "Acme", "model": "PIR-1",
     "sw_version": None, "via_device_id": "b1", "area": "Porch", "entities": 3, "available": 3},
    {"id": "d1", "name": "Attic plug", "name_by_user": None, "manufacturer": "Acme", "model": "PLUG-2",
     "sw_version": None, "via_device_id": "b1", "area": None, "entities": 2, "available": 0},
    {"id": "d3", "name": "Empty", "name_by_user": "", "manufacturer": "Acme", "model": "X",
     "sw_version": None, "via_device_id": "b1", "area": "Shed", "entities": 0, "available": 0},
    # MQTT, but not behind the bridge: not Zigbee.
    {"id": "m1", "name": "door-notify", "name_by_user": None, "manufacturer": "Home-made", "model": "app",
     "sw_version": None, "via_device_id": None, "area": None, "entities": 2, "available": 2},
]


def test_parses_the_template_result() -> None:
    assert parse_template_result(json.dumps(RAW)) == RAW
    with pytest.raises(Exception, match="not JSON"):
        parse_template_result("<html>")
    with pytest.raises(Exception, match="unexpected template result"):
        parse_template_result('{"a": 1}')


def test_selects_the_bridge_and_the_devices_behind_it_with_availability() -> None:
    data = build_zigbee(RAW, "7")
    assert data["coordinator"] == {"deviceId": "7", "version": "2.1.0"}
    assert data["devices"] == [
        {"id": "d1", "name": "Attic plug", "manufacturer": "Acme", "model": "PLUG-2", "area": None, "available": False},
        {"id": "d3", "name": "Empty", "manufacturer": "Acme", "model": "X", "area": "Shed", "available": False},  # no entities
        {"id": "d2", "name": "Porch sensor", "manufacturer": "Acme", "model": "PIR-1", "area": "Porch", "available": True},
    ]
    assert build_zigbee([r for r in RAW if r is not BRIDGE], None) == {"coordinator": {"deviceId": None, "version": None}, "devices": []}


def test_coordinator_is_the_netbox_device_with_the_zigbee_socket_service() -> None:
    services = [
        {"id": 5, "name": "http", "parent_object_type": "dcim.device", "parent": {"id": 3}},
        {"id": 9, "name": "zigbee-socket", "parent_object_type": "dcim.device", "parent": {"id": 19}},
        {"id": 11, "name": "zigbee-socket", "parent_object_type": "virtualization.virtualmachine", "parent": {"id": 4}},
    ]
    assert coordinator_from_services(services) == "19"
    assert coordinator_from_services(services[:1]) is None


def _source(handler, url: str = "http://ha.example", token: str = TOKEN) -> ZigbeeSource:
    return ZigbeeSource(url, token, httpx.AsyncClient(transport=httpx.MockTransport(handler)))


async def test_one_read_only_template_call_publishes_the_snapshot() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, text=json.dumps(RAW))

    source = _source(handler)
    source.set_services([{"id": 9, "name": "zigbee-socket", "parent_object_type": "dcim.device", "parent": {"id": 19}}])
    events: list[dict] = []
    source.attach(events.append)
    await source.cycle()
    assert [(c.method, c.url.path) for c in calls] == [("POST", "/api/template")]  # never /api/services
    assert json.loads(calls[0].content) == {"template": TEMPLATE}
    assert calls[0].headers["Authorization"] == f"Bearer {TOKEN}"
    assert events[0]["type"] == "data" and events[0]["data"]["coordinator"]["deviceId"] == "19"
    assert len(events[0]["data"]["devices"]) == 3
    assert events[1]["state"] == "live" and events[1]["error"] is None


async def test_source_is_off_without_config() -> None:
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must not be called
        raise AssertionError("no call without config")

    for url, token in (("", TOKEN), ("http://ha.example", "")):
        source = _source(handler, url, token)
        events: list[dict] = []
        source.attach(events.append)
        await source.cycle()
        assert events[0] == {"type": "data", "data": EMPTY}
        assert events[1]["state"] == "error"
        assert events[1]["error"] == "Zigbee: Home Assistant is not configured (HA_URL and HA_TOKEN)."


async def test_errors_are_prefixed_and_the_token_never_appears(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    answers = [
        httpx.Response(401, text=f"bad token {TOKEN}"),
        httpx.Response(200, text="not json " + TOKEN),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if not answers:
            raise httpx.ConnectError(f"failed for {TOKEN}", request=request)
        return answers.pop(0)

    source = _source(handler)
    events: list[dict] = []
    source.attach(events.append)
    for _ in range(3):
        await source.cycle()
    errors = [e["error"] for e in events if e["type"] == "status"]
    assert errors == [
        "Zigbee: Home Assistant responded with HTTP 401.",
        "Zigbee: Home Assistant returned something that is not JSON.",
        "Zigbee: Home Assistant is unreachable.",
    ]
    assert TOKEN not in json.dumps(events)
    assert TOKEN not in caplog.text
    assert TOKEN not in json.dumps(source.health())


async def test_a_new_coordinator_triggers_a_cycle() -> None:
    source = _source(lambda r: httpx.Response(200, text="[]"))
    seen: list[bool] = []
    source.refresh = lambda: seen.append(True)  # type: ignore[method-assign]
    service = {"id": 9, "name": "zigbee-socket", "parent_object_type": "dcim.device", "parent": {"id": 19}}
    source.set_services([service])
    source.set_services([service])
    source.set_services(None)
    assert seen == [True]
