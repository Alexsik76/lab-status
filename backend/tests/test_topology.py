from app.topology import build_topology


def iface(id_: int, device: int, name: str, **extra) -> dict:
    return {"id": id_, "name": name, "device": {"id": device, "name": f"dev-{device}"},
            "type": {"value": "1000base-t", "label": "1GE"}, "speed": None, "mode": None,
            "untagged_vlan": None, "tagged_vlans": [], "mgmt_only": False, **extra}


def end(interface: dict) -> list[dict]:
    return [{"object_type": "dcim.interface", "object_id": interface["id"],
             "object": {"id": interface["id"], "name": interface["name"], "device": interface["device"]}}]


def cable(id_: int, a: dict, b: dict, status: str = "connected", type_: str | None = "cat6") -> dict:
    return {"id": id_, "type": type_, "status": {"value": status, "label": status},
            "a_terminations": end(a), "b_terminations": end(b)}


DEVICES = [
    {"id": 1, "name": "core-rtr", "status": {"value": "active"}},
    {"id": 2, "name": "sw-a", "status": {"value": "active"}},
    {"id": 3, "name": "host-a", "status": {"value": "offline"}},
    {"id": 4, "name": "spare-sw", "status": {"value": "inventory"}},
]
R1 = iface(10, 1, "ether1")
R2 = iface(11, 1, "ether2", mode={"value": "tagged"}, tagged_vlans=[{"vid": 30}, {"vid": 10}],
           untagged_vlan={"vid": 1}, type={"value": "10gbase-x-sfpp"}, speed=10_000_000)
R3 = iface(12, 1, "ether3")
S1 = iface(20, 2, "port1", mode={"value": "access"}, untagged_vlan={"vid": 10})
S2 = iface(21, 2, "port2")
H1 = iface(30, 3, "eth0", mgmt_only=True)
X1 = iface(40, 4, "port1")
INTERFACES = [R1, R2, R3, S1, S2, H1, X1]
VLANS = [{"vid": 30, "name": "lab"}, {"vid": 10, "name": "trust"}, {"vid": 10, "name": "other-group"}]


def test_compact_structure_of_connected_interface_cables() -> None:
    cables = [cable(100, R2, S1), cable(101, S2, H1, type_=None)]
    topo = build_topology(cables, INTERFACES, VLANS, DEVICES)

    assert topo["vlans"] == [{"vid": 10, "name": "trust"}, {"vid": 30, "name": "lab"}]
    assert topo["cables"] == [{"id": "100", "type": "cat6", "a": "11", "b": "20"},
                              {"id": "101", "type": None, "a": "21", "b": "30"}]
    ports = {p["id"]: p for p in topo["ports"]}
    assert list(ports) == ["11", "20", "21", "30"]  # only ports that terminate a cable
    assert ports["11"] == {"id": "11", "deviceId": "1", "name": "ether2", "order": 1, "type": "10gbase-x-sfpp",
                           "speedKbps": 10_000_000, "mode": "tagged", "untagged": 1, "tagged": [10, 30],
                           "mgmtOnly": False}
    assert ports["20"]["mode"] == "access" and ports["20"]["untagged"] == 10 and ports["20"]["order"] == 0
    assert ports["21"]["order"] == 1
    assert ports["30"]["mgmtOnly"] is True and ports["30"]["untagged"] is None and ports["30"]["tagged"] == []


def test_only_connected_cables_between_two_interfaces() -> None:
    power = {"id": 102, "type": "power", "status": {"value": "connected"},
             "a_terminations": [{"object_type": "dcim.powerport", "object": {"id": 9, "device": {"id": 1}}}],
             "b_terminations": end(R3)}
    split = {**cable(103, R1, S1), "b_terminations": end(S1) + end(S2)}
    cables = [cable(100, R1, S1, status="planned"), cable(101, R3, S2, status="decommissioning"), power, split,
              {**cable(104, R1, S2), "b_terminations": []}]
    topo = build_topology(cables, INTERFACES, VLANS, DEVICES)
    assert topo["cables"] == [] and topo["ports"] == []


def test_cables_touching_reserve_hardware_are_dropped() -> None:
    topo = build_topology([cable(100, R1, X1), cable(101, R3, S2)], INTERFACES, VLANS, DEVICES)
    assert [c["id"] for c in topo["cables"]] == ["101"]
    assert "40" not in {p["id"] for p in topo["ports"]} and "10" not in {p["id"] for p in topo["ports"]}


def test_cable_to_an_unknown_interface_is_dropped() -> None:
    ghost = iface(99, 2, "port9")
    assert build_topology([cable(100, R1, ghost)], INTERFACES, VLANS, DEVICES)["cables"] == []
