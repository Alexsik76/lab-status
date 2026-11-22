"""The `zigbee` source: the Zigbee2MQTT network as Home Assistant knows it, read-only.

One short WebSocket connection per cycle to `{HA_URL}/api/websocket` (ws/wss from http/https),
which a non-admin user may use: authenticate with the token, send `config/device_registry/list`,
`config/entity_registry/list`, `config/area_registry/list` and `get_states`, close. No service
is called, nothing is subscribed to, no registry is changed. From the registries, the
Zigbee2MQTT bridge (manufacturer `Zigbee2MQTT`) and every device whose `via_device_id` is that
bridge:

    {"coordinator": {"deviceId", "version"},
     "devices":     [{"id", "name", "manufacturer", "model", "area", "available"}]}

`coordinator.deviceId` is the NetBox device with a service named `zigbee-socket` (from the
inventory cycle); `version` the bridge's software version (Zigbee2MQTT) when exposed. A device
is `available` when at least one of its entities has a state other than `unavailable`. The
source is off (status error, empty data) unless HA_URL and HA_TOKEN are set; errors start with
"Zigbee: ". The token is only ever sent in the `auth` message: no message, log or event
contains it.
"""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

import websockets
from websockets.asyncio.client import connect as ws_connect

from .polling import PollingSource

log = logging.getLogger(__name__)
#: The WebSocket library logs every frame at DEBUG, the `auth` frame included: its logger for this
#: source never goes below INFO, whatever the root level.
ws_log = logging.getLogger(__name__ + ".websocket")
ws_log.setLevel(logging.INFO)

Json = dict[str, Any]

ZIGBEE_PERIOD_S = 60.0
ZIGBEE_TIMEOUT_S = 20.0
#: Largest WebSocket message accepted (the entity registry and the states are the big ones).
MAX_MESSAGE_BYTES = 16 * 1024 * 1024
ERROR_PREFIX = "Zigbee: "
BRIDGE_MANUFACTURER = "Zigbee2MQTT"
#: The NetBox service that marks the coordinator's host (e.g. a Zigbee-to-Ethernet adapter).
COORDINATOR_SERVICE = "zigbee-socket"
#: The read-only commands sent on each connection, in order.
COMMANDS = ("config/device_registry/list", "config/entity_registry/list", "config/area_registry/list", "get_states")

EMPTY: Json = {"coordinator": {"deviceId": None, "version": None}, "devices": []}


class ZigbeeError(Exception):
    """A failed read, with the message shown on the page (never containing the token)."""


class Connection(Protocol):
    async def send(self, message: str) -> None: ...
    async def recv(self) -> str | bytes: ...
    async def close(self) -> None: ...


Connect = Callable[[str], Awaitable[Connection]]


def websocket_url(ha_url: str) -> str:
    """`{HA_URL}/api/websocket` with ws:// for http:// and wss:// for https://."""
    url = ha_url.rstrip("/")
    if url.startswith("https://"):
        url = "wss://" + url[len("https://"):]
    elif url.startswith("http://"):
        url = "ws://" + url[len("http://"):]
    return f"{url}/api/websocket"


async def default_connect(url: str) -> Connection:
    return await ws_connect(url, max_size=MAX_MESSAGE_BYTES, open_timeout=ZIGBEE_TIMEOUT_S, proxy=None, logger=ws_log)


def _text(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _records(value: Any, what: str) -> list[Json]:
    if not isinstance(value, list) or not all(isinstance(r, dict) for r in value):
        raise ZigbeeError(f"Home Assistant returned an unexpected {what}.")
    return value


def build_raw(devices: Any, entities: Any, areas: Any, states: Any) -> list[Json]:
    """One record per registry device: its fields, its area name and its entity counts."""
    devices = _records(devices, "device registry")
    entities = _records(entities, "entity registry")
    areas = _records(areas, "area registry")
    states = _records(states, "state list")
    area_names = {a.get("area_id"): _text(a.get("name")) for a in areas}
    state_of = {s.get("entity_id"): s.get("state") for s in states}
    total: dict[Any, int] = {}
    live: dict[Any, int] = {}
    for entity in entities:
        device_id = entity.get("device_id")
        if device_id is None:
            continue
        total[device_id] = total.get(device_id, 0) + 1
        state = state_of.get(entity.get("entity_id"))
        if state is not None and state != "unavailable":
            live[device_id] = live.get(device_id, 0) + 1
    return [
        {
            "id": d.get("id"),
            "name": d.get("name"),
            "name_by_user": d.get("name_by_user"),
            "manufacturer": d.get("manufacturer"),
            "model": d.get("model"),
            "sw_version": d.get("sw_version"),
            "via_device_id": d.get("via_device_id"),
            "area": area_names.get(d.get("area_id")),
            "entities": total.get(d.get("id"), 0),
            "available": live.get(d.get("id"), 0),
        }
        for d in devices
    ]


def build_zigbee(raw: list[Json], coordinator_device_id: str | None) -> Json:
    """The bridge and the devices behind it; no bridge means no devices."""
    bridge = next((d for d in raw if (_text(d.get("manufacturer")) or "").startswith(BRIDGE_MANUFACTURER)), None)
    devices: list[Json] = []
    if bridge is not None:
        for d in raw:
            if d.get("via_device_id") != bridge.get("id") or d is bridge:
                continue
            entities = d.get("entities") if isinstance(d.get("entities"), int) else 0
            live = d.get("available") if isinstance(d.get("available"), int) else 0
            devices.append({
                "id": str(d.get("id")),
                "name": _text(d.get("name_by_user")) or _text(d.get("name")) or str(d.get("id")),
                "manufacturer": _text(d.get("manufacturer")),
                "model": _text(d.get("model")),
                "area": _text(d.get("area")),
                "available": entities > 0 and live > 0,
            })
    devices.sort(key=lambda d: (d["name"].lower(), d["id"]))
    return {
        "coordinator": {"deviceId": coordinator_device_id, "version": _text((bridge or {}).get("sw_version"))},
        "devices": devices,
    }


def coordinator_from_services(services: list[Json]) -> str | None:
    """The NetBox device with a service named `zigbee-socket` (the first by service id)."""
    for service in sorted(services, key=lambda s: s.get("id") or 0):
        if service.get("name") == COORDINATOR_SERVICE and service.get("parent_object_type") == "dcim.device":
            parent = service.get("parent") or {}
            if parent.get("id") is not None:
                return str(parent["id"])
    return None


async def _receive(ws: Connection) -> Json:
    raw = await ws.recv()
    try:
        message = json.loads(raw)
    except ValueError as exc:
        raise ZigbeeError("Home Assistant sent something that is not JSON.") from exc
    if not isinstance(message, dict):
        raise ZigbeeError("Home Assistant sent an unexpected message.")
    return message


async def read_registries(ws: Connection, token: str) -> list[Any]:
    """Authenticate on an open connection, then send `COMMANDS`; their results, in order."""
    hello = await _receive(ws)
    if hello.get("type") != "auth_required":
        raise ZigbeeError("Home Assistant did not ask for authentication.")
    await ws.send(json.dumps({"type": "auth", "access_token": token}))
    answer = await _receive(ws)
    if answer.get("type") == "auth_invalid":
        raise ZigbeeError("Home Assistant rejected the token.")
    if answer.get("type") != "auth_ok":
        raise ZigbeeError("Home Assistant did not confirm authentication.")
    results: list[Any] = []
    for number, command in enumerate(COMMANDS, start=1):
        await ws.send(json.dumps({"id": number, "type": command}))
        while True:
            message = await _receive(ws)
            if message.get("type") == "result" and message.get("id") == number:
                break
        if not message.get("success"):
            code = _text((message.get("error") or {}).get("code")) if isinstance(message.get("error"), dict) else None
            raise ZigbeeError(f"Home Assistant refused {command} ({code or 'no code'}).")
        results.append(message.get("result"))
    return results


class ZigbeeSource(PollingSource):
    def __init__(
        self, ha_url: str, ha_token: str, connect: Connect = default_connect, period_s: float = ZIGBEE_PERIOD_S
    ) -> None:
        super().__init__("zigbee", period_s)
        self._url = ha_url.rstrip("/")
        self._token = ha_token
        self._connect = connect
        self._coordinator: str | None = None

    @property
    def configured(self) -> bool:
        return bool(self._url and self._token)

    def set_services(self, services: list[Json] | None) -> None:
        """From the inventory cycle: re-read when the coordinator's NetBox device changes."""
        if services is None:
            return
        coordinator = coordinator_from_services(services)
        if coordinator != self._coordinator:
            self._coordinator = coordinator
            self.refresh()

    async def _read(self) -> list[Json]:
        async with asyncio.timeout(ZIGBEE_TIMEOUT_S):
            ws = await self._connect(websocket_url(self._url))
            try:
                devices, entities, areas, states = await read_registries(ws, self._token)
            finally:
                await ws.close()
        return build_raw(devices, entities, areas, states)

    async def fetch(self) -> Json:
        try:
            if not self.configured:
                raise ZigbeeError("Home Assistant is not configured (HA_URL and HA_TOKEN).")
            raw = await self._read()
        except Exception:
            if not self.has_data or self.data != EMPTY:
                self.data, self.has_data = EMPTY, True
                self.publish(self._data_event())
            raise
        return build_zigbee(raw, self._coordinator)

    def describe_error(self, exc: Exception) -> str:
        if isinstance(exc, ZigbeeError):
            message = str(exc)
        elif isinstance(exc, TimeoutError):
            message = "Home Assistant did not respond in time."
        elif isinstance(exc, websockets.InvalidStatus):
            message = f"Home Assistant responded with HTTP {exc.response.status_code}."
        elif isinstance(exc, websockets.ConnectionClosed):
            message = "Home Assistant closed the connection."
        elif isinstance(exc, (OSError, websockets.InvalidHandshake, websockets.InvalidURI)):
            message = "Home Assistant is unreachable."
        else:
            message = f"unexpected error ({type(exc).__name__})."
        if self._token:
            message = message.replace(self._token, "***")
        return ERROR_PREFIX + message
