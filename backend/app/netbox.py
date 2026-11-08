"""NetBox REST reads: the MAC directory for ARP enrichment and the service check targets."""

from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings

Json = dict[str, Any]


class NetBoxClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._base = settings.netbox_url
        self._headers = {"Authorization": f"Token {settings.netbox_token}", "Accept": "application/json"}
        self._client = client

    async def list(self, path: str) -> list[Json]:
        """All objects of an endpoint, following pagination."""
        url: str | None = f"{self._base}/api/{path}?limit=1000"
        items: list[Json] = []
        while url:
            response = await self._client.get(url, headers=self._headers, timeout=20.0)
            response.raise_for_status()
            body = response.json()
            items.extend(body["results"])
            url = body.get("next")
        return items


def _choice(value: Any) -> str | None:
    """Select fields arrive as `{"value": ..., "label": ...}` (or a plain string in older NetBox)."""
    if isinstance(value, dict):
        return value.get("value")
    return value


def _primary_ip(obj: Json | None) -> str | None:
    address = ((obj or {}).get("primary_ip4") or {}).get("address")
    return address.split("/")[0] if address else None


# ---- MAC directory -------------------------------------------------------------------


@dataclass(frozen=True)
class MacMatch:
    kind: str  # "device" | "vm"
    id: str
    name: str
    role: str | None
    status: str | None
    description: str
    interface: str | None
    url: str | None

    def as_json(self) -> Json:
        return {
            "kind": self.kind,
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "status": self.status,
            "description": self.description,
            "interface": self.interface,
            "url": self.url,
        }


def build_mac_directory(
    mac_addresses: list[Json], devices: list[Json], vms: list[Json], public_url: str = ""
) -> dict[str, MacMatch]:
    """MAC (upper case) -> the NetBox object owning the interface with that MAC."""
    objects: dict[tuple[str, int], Json] = {}
    for device in devices:
        objects[("device", device["id"])] = device
    for vm in vms:
        objects[("vm", vm["id"])] = vm

    directory: dict[str, MacMatch] = {}
    for entry in mac_addresses:
        assigned = entry.get("assigned_object") or {}
        kind_type = entry.get("assigned_object_type")
        if kind_type == "dcim.interface" and assigned.get("device"):
            kind, owner = "device", assigned["device"]
            path = "dcim/devices"
        elif kind_type == "virtualization.vminterface" and assigned.get("virtual_machine"):
            kind, owner = "vm", assigned["virtual_machine"]
            path = "virtualization/virtual-machines"
        else:
            continue
        obj = objects.get((kind, owner["id"]), owner)
        mac = str(entry.get("mac_address") or "").upper()
        if not mac or mac in directory:
            continue
        directory[mac] = MacMatch(
            kind=kind,
            id=str(owner["id"]),
            name=obj.get("name") or owner.get("name") or "",
            role=((obj.get("role") or {}).get("name")),
            status=_choice(obj.get("status")),
            description=obj.get("description") or "",
            interface=assigned.get("name"),
            url=f"{public_url}/{path}/{owner['id']}/" if public_url else None,
        )
    return directory


async def fetch_mac_directory(netbox: NetBoxClient, public_url: str) -> dict[str, MacMatch]:
    macs = await netbox.list("dcim/mac-addresses/")
    devices = await netbox.list("dcim/devices/")
    vms = await netbox.list("virtualization/virtual-machines/")
    return build_mac_directory(macs, devices, vms, public_url)


# ---- Service check targets -------------------------------------------------------------


@dataclass(frozen=True)
class Target:
    name: str
    url: str
    service_id: int


def build_targets(services: list[Json], vms: list[Json], devices: list[Json]) -> list[Target]:
    """Same rules as the n8n `Service targets ← NetBox` sync.

    Only services with a `scheme`; services whose parent is offline are skipped. Address:
    the IP bound to the service, else the host VM's primary IP for a container, else the
    parent's own primary IP.
    """
    vm_by_id = {vm["id"]: vm for vm in vms}
    device_by_id = {device["id"]: device for device in devices}
    targets: list[Target] = []
    for service in services:
        scheme = _choice((service.get("custom_fields") or {}).get("scheme"))
        ports = service.get("ports") or []
        parent_ref = service.get("parent") or {}
        if not scheme or not ports or not parent_ref:
            continue
        on_device = service.get("parent_object_type") == "dcim.device"
        parent = (device_by_id if on_device else vm_by_id).get(parent_ref.get("id"))
        if parent is None or _choice(parent.get("status")) == "offline":
            continue

        bound = service.get("ipaddresses") or []
        ip = bound[0]["address"].split("/")[0] if bound else None
        if not ip and not on_device:
            host = (parent.get("custom_fields") or {}).get("host")
            ip = _primary_ip(vm_by_id.get(host["id"])) if host else _primary_ip(parent)
        if not ip and on_device:
            ip = _primary_ip(parent)
        if not ip:
            continue

        parent_name = parent_ref.get("name") or parent.get("name") or ""
        name = service["name"] if parent_name == service["name"] else f"{parent_name}/{service['name']}"
        targets.append(Target(name=name, url=f"{scheme}://{ip}:{ports[0]}", service_id=service["id"]))
    return targets


async def fetch_targets(netbox: NetBoxClient) -> list[Target]:
    services = await netbox.list("ipam/services/")
    vms = await netbox.list("virtualization/virtual-machines/")
    devices = await netbox.list("dcim/devices/")
    return build_targets(services, vms, devices)
