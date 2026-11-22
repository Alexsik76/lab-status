"""The `zigbee` source: the Zigbee2MQTT network as Home Assistant knows it, read-only.

One call per cycle: `POST {HA_URL}/api/template` with a template that renders the MQTT
devices as JSON (no service is ever called, no state is changed). From them, the Zigbee2MQTT
bridge (manufacturer `Zigbee2MQTT`) and every device whose `via_device` is that bridge:

    {"coordinator": {"deviceId", "version"},
     "devices":     [{"id", "name", "manufacturer", "model", "area", "available"}]}

`coordinator.deviceId` is the NetBox device with a service named `zigbee-socket` (from the
inventory cycle); `version` the bridge's software version (Zigbee2MQTT) when exposed. A device
is `available` when at least one of its entities is not `unavailable`. The source is off (status
error, empty data) unless HA_URL and HA_TOKEN are set; errors start with "Zigbee: ". The token
is only ever sent in the Authorization header: no message, log or event contains it.
"""

import json
import logging
from typing import Any

import httpx

from .polling import PollingSource

log = logging.getLogger(__name__)

Json = dict[str, Any]

ZIGBEE_PERIOD_S = 60.0
ERROR_PREFIX = "Zigbee: "
BRIDGE_MANUFACTURER = "Zigbee2MQTT"
#: The NetBox service that marks the coordinator's host (e.g. a Zigbee-to-Ethernet adapter).
COORDINATOR_SERVICE = "zigbee-socket"

EMPTY: Json = {"coordinator": {"deviceId": None, "version": None}, "devices": []}

TEMPLATE = """{%- set ns = namespace(out=[]) -%}
{%- for d in integration_entities('mqtt') | map('device_id') | reject('none') | unique -%}
{%- set ents = device_entities(d) -%}
{%- set ns.out = ns.out + [{
  'id': d,
  'name': device_attr(d, 'name'),
  'name_by_user': device_attr(d, 'name_by_user'),
  'manufacturer': device_attr(d, 'manufacturer'),
  'model': device_attr(d, 'model'),
  'sw_version': device_attr(d, 'sw_version'),
  'via_device_id': device_attr(d, 'via_device_id'),
  'area': area_name(d),
  'entities': ents | count,
  'available': ents | map('states') | reject('eq', 'unavailable') | list | count
}] -%}
{%- endfor -%}
{{ ns.out | tojson }}"""


class ZigbeeError(Exception):
    """A failed read, with the message shown on the page (never containing the token)."""


def _text(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def parse_template_result(text: str) -> list[Json]:
    """The template's rendered JSON: a list of device objects."""
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise ZigbeeError("Home Assistant returned something that is not JSON.") from exc
    if not isinstance(data, list) or not all(isinstance(d, dict) for d in data):
        raise ZigbeeError("Home Assistant returned an unexpected template result.")
    return data


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


class ZigbeeSource(PollingSource):
    def __init__(self, ha_url: str, ha_token: str, client: httpx.AsyncClient, period_s: float = ZIGBEE_PERIOD_S) -> None:
        super().__init__("zigbee", period_s)
        self._url = ha_url.rstrip("/")
        self._token = ha_token
        self._client = client
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

    async def fetch(self) -> Json:
        try:
            if not self.configured:
                raise ZigbeeError("Home Assistant is not configured (HA_URL and HA_TOKEN).")
            response = await self._client.post(
                f"{self._url}/api/template",
                json={"template": TEMPLATE},
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=20.0,
            )
            if response.status_code != 200:
                raise ZigbeeError(f"Home Assistant responded with HTTP {response.status_code}.")
            raw = parse_template_result(response.text)
        except Exception:
            if not self.has_data or self.data != EMPTY:
                self.data, self.has_data = EMPTY, True
                self.publish(self._data_event())
            raise
        return build_zigbee(raw, self._coordinator)

    def describe_error(self, exc: Exception) -> str:
        if isinstance(exc, ZigbeeError):
            message = str(exc)
        elif isinstance(exc, httpx.TimeoutException):
            message = "Home Assistant did not respond in time."
        elif isinstance(exc, httpx.HTTPError):
            message = "Home Assistant is unreachable."
        else:
            message = f"unexpected error ({type(exc).__name__})."
        if self._token:
            message = message.replace(self._token, "***")
        return ERROR_PREFIX + message
