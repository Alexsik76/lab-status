from app.netbox import build_mac_directory, build_targets

DEVICES = [
    {"id": 1, "name": "srv-a", "status": {"value": "active"}, "role": {"name": "Server"}, "description": "",
     "primary_ip4": {"address": "192.0.2.10/24"}, "custom_fields": {}},
    {"id": 2, "name": "srv-off", "status": {"value": "offline"}, "role": {"name": "Server"}, "description": "",
     "primary_ip4": {"address": "192.0.2.11/24"}, "custom_fields": {}},
]
VMS = [
    {"id": 10, "name": "vm-a", "status": {"value": "active"}, "role": None, "description": "Docker host",
     "primary_ip4": {"address": "192.0.2.20/24"}, "custom_fields": {"host": None}},
    {"id": 11, "name": "app", "status": {"value": "active"}, "role": None, "description": "",
     "primary_ip4": None, "custom_fields": {"host": {"id": 10, "name": "vm-a"}}},
]


def _service(id_, name, parent_type, parent_id, parent_name, port, scheme="http", ips=()):
    return {
        "id": id_, "name": name, "ports": [port],
        "custom_fields": {"scheme": {"value": scheme, "label": scheme} if scheme else None},
        "parent_object_type": parent_type,
        "parent": {"id": parent_id, "name": parent_name},
        "ipaddresses": [{"address": ip} for ip in ips],
    }


def test_targets_follow_n8n_rules() -> None:
    services = [
        _service(100, "web", "dcim.device", 1, "srv-a", 443, "https"),
        _service(101, "web", "dcim.device", 2, "srv-off", 80),  # offline parent: skipped
        _service(102, "app", "virtualization.virtualmachine", 11, "app", 8080),  # container -> host IP
        _service(103, "api", "virtualization.virtualmachine", 10, "vm-a", 9000, ips=["192.0.2.99/24"]),
        _service(104, "ssh", "virtualization.virtualmachine", 10, "vm-a", 22, scheme=None),  # no scheme
    ]
    targets = build_targets(services, VMS, DEVICES)
    assert [(t.name, t.url, t.service_id) for t in targets] == [
        ("srv-a/web", "https://192.0.2.10:443", 100),
        ("app", "http://192.0.2.20:8080", 102),
        ("vm-a/api", "http://192.0.2.99:9000", 103),
    ]


def test_mac_directory_resolves_devices_and_vms() -> None:
    macs = [
        {"mac_address": "02:00:00:00:00:aa", "assigned_object_type": "dcim.interface",
         "assigned_object": {"id": 5, "name": "eth0", "device": {"id": 1, "name": "srv-a"}}},
        {"mac_address": "02:00:00:00:00:bb", "assigned_object_type": "virtualization.vminterface",
         "assigned_object": {"id": 6, "name": "ens18", "virtual_machine": {"id": 10, "name": "vm-a"}}},
        {"mac_address": "02:00:00:00:00:cc", "assigned_object_type": None, "assigned_object": None},
    ]
    directory = build_mac_directory(macs, DEVICES, VMS, "https://netbox.example")
    assert set(directory) == {"02:00:00:00:00:AA", "02:00:00:00:00:BB"}
    device = directory["02:00:00:00:00:AA"]
    assert (device.kind, device.id, device.name, device.role, device.interface) == (
        "device", "1", "srv-a", "Server", "eth0")
    assert device.url == "https://netbox.example/dcim/devices/1/"
    vm = directory["02:00:00:00:00:BB"]
    assert (vm.kind, vm.id, vm.url) == (
        "vm", "10", "https://netbox.example/virtualization/virtual-machines/10/")


def test_mac_directory_without_public_url_has_no_links() -> None:
    macs = [{"mac_address": "02:00:00:00:00:aa", "assigned_object_type": "dcim.interface",
             "assigned_object": {"id": 5, "name": "eth0", "device": {"id": 1, "name": "srv-a"}}}]
    assert build_mac_directory(macs, DEVICES, VMS)["02:00:00:00:00:AA"].url is None
