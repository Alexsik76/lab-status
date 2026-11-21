"""The physical topology: NetBox cables between interfaces, reduced to what the page draws.

    {"vlans":  [{"vid", "name"}],
     "ports":  [{"id", "deviceId", "name", "order", "type", "speedKbps", "mode",
                 "untagged", "tagged", "mgmtOnly"}],
     "cables": [{"id", "type", "a", "b"}]}

Only connected cables with exactly one interface on each end are kept, and none that touches
a device kept in reserve (status `inventory`, hidden on the page as well). Only ports that
terminate a kept cable are listed; `order` is the interface's index in NetBox's own (natural)
order within its device. Ids are strings, like the ids of the page's GraphQL inventory.
"""

from typing import Any

Json = dict[str, Any]

#: Device status of hardware kept in reserve.
RESERVE_STATUS = "inventory"


def _choice(value: Any) -> str | None:
    if isinstance(value, dict):
        return value.get("value")
    return value


def _end(terminations: Any) -> Json | None:
    """The interface of a cable end, or None when the end is not a single interface."""
    if not isinstance(terminations, list) or len(terminations) != 1:
        return None
    term = terminations[0] or {}
    if term.get("object_type") != "dcim.interface":
        return None
    obj = term.get("object") or {}
    if obj.get("id") is None or not (obj.get("device") or {}).get("id"):
        return None
    return obj


def build_topology(cables: list[Json], interfaces: list[Json], vlans: list[Json], devices: list[Json]) -> Json:
    reserve = {d["id"] for d in devices if _choice(d.get("status")) == RESERVE_STATUS}
    by_id = {i["id"]: i for i in interfaces}

    # Natural order within each device: NetBox lists interfaces sorted by device, then name.
    order: dict[int, int] = {}
    seen_per_device: dict[int, int] = {}
    for interface in interfaces:
        device_id = (interface.get("device") or {}).get("id")
        n = seen_per_device.get(device_id, 0)
        order[interface["id"]] = n
        seen_per_device[device_id] = n + 1

    kept: list[Json] = []
    used: set[int] = set()
    for cable in cables:
        if _choice(cable.get("status")) != "connected":
            continue
        a, b = _end(cable.get("a_terminations")), _end(cable.get("b_terminations"))
        if a is None or b is None or a["id"] not in by_id or b["id"] not in by_id:
            continue
        if a["device"]["id"] in reserve or b["device"]["id"] in reserve:
            continue
        kept.append({"id": str(cable["id"]), "type": cable.get("type") or None, "a": str(a["id"]), "b": str(b["id"])})
        used.update((a["id"], b["id"]))

    ports: list[Json] = []
    for interface in interfaces:
        if interface["id"] not in used:
            continue
        untagged = interface.get("untagged_vlan") or {}
        ports.append({
            "id": str(interface["id"]),
            "deviceId": str(interface["device"]["id"]),
            "name": interface.get("name") or "",
            "order": order[interface["id"]],
            "type": _choice(interface.get("type")),
            "speedKbps": interface.get("speed") or None,
            "mode": _choice(interface.get("mode")),
            "untagged": untagged.get("vid"),
            "tagged": sorted(v["vid"] for v in interface.get("tagged_vlans") or [] if v.get("vid") is not None),
            "mgmtOnly": bool(interface.get("mgmt_only")),
        })

    names: dict[int, str] = {}
    for vlan in vlans:  # the same vid in several VLAN groups: the first name wins
        if vlan.get("vid") is not None:
            names.setdefault(vlan["vid"], vlan.get("name") or "")
    vlan_list = [{"vid": vid, "name": names[vid]} for vid in sorted(names)]
    return {"vlans": vlan_list, "ports": ports, "cables": kept}
