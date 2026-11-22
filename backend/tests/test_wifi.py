import asyncio
from collections.abc import AsyncIterator

from app.arp import ClientHints
from app.netbox import MacMatch
from app.routeros import Reply
from app.wifi import EMPTY, WifiSource, band_of, build_wifi, radio_state, read_menus, uptime_text

# Invented network: three access points (one known to NetBox by MAC, one by name, one unknown).
CAPS = [
    {"name": "[02:AA:00:00:00:01]", "identity": "ap-hall", "base-mac": "02:AA:00:00:00:01"},
    {"name": "[02:AA:00:00:00:02]", "identity": "ap-yard", "base-mac": "02:AA:00:00:00:02"},
    {"name": "[02:AA:00:00:00:03]", "identity": "ap-shed", "base-mac": "02:AA:00:00:00:03"},
]
RADIOS = [
    {"radio-mac": "02:AA:00:00:01:01", "remote-cap-name": "[02:AA:00:00:00:01]", "interface": "hall-2g"},
    {"radio-mac": "02:AA:00:00:01:02", "remote-cap-name": "[02:AA:00:00:00:01]", "interface": "hall-5g"},
    {"radio-mac": "02:AA:00:00:02:01", "remote-cap-name": "[02:AA:00:00:00:02]", "interface": "yard-2g"},
    {"radio-mac": "02:AA:00:00:03:01", "remote-cap-name": "[02:AA:00:00:00:03]", "interface": "shed-2g"},
]
INTERFACES = [
    {"name": "hall-2g", "mac-address": "02:AA:00:00:01:01", "master-interface": "none", "configuration": "cfg-things",
     "current-channel": "2437/20/gn(20dBm)", "disabled": "false", "running": "true"},
    {"name": "hall-2g-1", "mac-address": "06:AA:00:00:01:01", "master-interface": "hall-2g", "configuration": "cfg-guests",
     "disabled": "false", "running": "true"},
    {"name": "hall-5g", "mac-address": "02:AA:00:00:01:02", "master-interface": "none", "configuration": "cfg-home-5",
     "current-channel": "5180/20-Ceee/ac/P(20dBm)", "disabled": "false", "running": "false"},
    {"name": "yard-2g", "mac-address": "02:AA:00:00:02:01", "master-interface": "none", "configuration": "cfg-things",
     "current-channel": "2462/20/gn(20dBm)", "disabled": "false", "running": "true"},
    {"name": "shed-2g", "mac-address": "02:AA:00:00:03:01", "master-interface": "none", "configuration": "cfg-things-2g",
     "disabled": "true", "running": "false"},
]
CONFIGS = [
    # A passphrase-like field must never reach the payload.
    {"name": "cfg-things", "ssid": "Things", "datapath": "dp-things", "channel": "2G-Auto", "security.passphrase": "x"},
    {"name": "cfg-things-2g", "ssid": "Things", "datapath": "dp-things", "channel": "2G-Auto"},
    {"name": "cfg-guests", "ssid": "Guests", "datapath": "dp-home", "datapath.vlan-id": "50"},
    {"name": "cfg-home-5", "ssid": "Home", "datapath": "dp-home", "channel": "5G-Auto", "security": "prof-home"},
]
DATAPATHS = [{"name": "dp-things", "vlan-id": "30"}, {"name": "dp-home", "vlan-id": "10"}]
REGISTRATIONS = [
    {"interface": "hall-2g", "ssid": "Things", "mac-address": "02:BB:00:00:00:01", "rx-signal": "-61",
     "uptime": "1d02:03:04.500", "last-ip": "192.0.2.201"},
    {"interface": "hall-2g-1", "ssid": "Guests", "mac-address": "02:BB:00:00:00:02", "rx-signal": "-70", "uptime": "5m3s120ms"},
    {"interface": "yard-2g", "ssid": "Things", "mac-address": "02:BB:00:00:00:03", "rx-signal": "-55", "uptime": "1h"},
    {"interface": "yard-2g", "ssid": "Things", "mac-address": "02:BB:00:00:00:04", "rx-signal": "-80", "uptime": "2h"},
    {"interface": "yard-2g", "ssid": "Things", "mac-address": "02:BB:00:00:00:05", "rx-signal": "", "uptime": ""},
]
MENUS = {"interfaces": INTERFACES, "configurations": CONFIGS, "datapaths": DATAPATHS, "caps": CAPS,
         "radios": RADIOS, "registrations": REGISTRATIONS}

MACS = {
    "02:AA:00:00:01:02": MacMatch("device", "71", "hall-ap", "Access point", "active", "", "wlan2", None),
    "02:BB:00:00:00:01": MacMatch("device", "81", "plug-one", "IoT", "active", "", "wlan0", None),
}
DEVICE_IDS = {"ap-yard": "72", "plug-one": "81"}
HINTS = {
    "02:BB:00:00:00:01": ClientHints("lease note", "plug-host", "192.0.2.11"),
    "02:BB:00:00:00:02": ClientHints(None, "guest-phone", None),
    "02:BB:00:00:00:03": ClientHints("Kitchen sensor", "esp-123", "192.0.2.13"),
}


def build() -> dict:
    return build_wifi(MENUS, MACS, DEVICE_IDS, lambda mac: HINTS.get(mac, ClientHints()))


def test_access_points_matched_by_mac_by_identity_or_not_at_all() -> None:
    aps = {a["id"]: a for a in build()["aps"]}
    assert aps["[02:AA:00:00:00:01]"] == {"id": "[02:AA:00:00:00:01]", "name": "hall-ap", "deviceId": "71"}  # radio MAC
    assert aps["[02:AA:00:00:00:02]"] == {"id": "[02:AA:00:00:00:02]", "name": "ap-yard", "deviceId": "72"}  # identity
    assert aps["[02:AA:00:00:00:03]"] == {"id": "[02:AA:00:00:00:03]", "name": "ap-shed", "deviceId": None}


def test_networks_with_vlan_from_configuration_datapath() -> None:
    assert build()["networks"] == [
        {"ssid": "Guests", "band": "2.4", "vlan": 50},  # inline datapath.vlan-id wins
        {"ssid": "Home", "band": "5", "vlan": 10},
        {"ssid": "Things", "band": "2.4", "vlan": 30},
    ]


def test_slave_interface_belongs_to_its_masters_radio() -> None:
    radios = build()["radios"]
    guests = [r for r in radios if r["ssid"] == "Guests"]
    assert guests == [{"apId": "[02:AA:00:00:00:01]", "ssid": "Guests", "band": "2.4", "channel": 2437, "state": "running"}]


def test_radio_states_running_disabled_down() -> None:
    by = {(r["apId"], r["ssid"]): r for r in build()["radios"]}
    assert by[("[02:AA:00:00:00:01]", "Things")]["state"] == "running"
    assert by[("[02:AA:00:00:00:01]", "Home")]["state"] == "down"  # enabled but not running
    shed = by[("[02:AA:00:00:00:03]", "Things")]
    assert shed == {"apId": "[02:AA:00:00:00:03]", "ssid": "Things", "band": "2.4", "channel": None, "state": "disabled"}


def test_broadcasting_radio_without_clients_is_running_despite_the_running_flag() -> None:
    # Live case: current-state running-ap, flags MDB (no R), no registered clients.
    quiet = {"name": "hall-5g", "mac-address": "02:AA:00:00:01:02", "master-interface": "none",
             "configuration": "cfg-home-5", "current-channel": "5745/20-Ceee/ac/P(20dBm)",
             "current-state": "running-ap", "disabled": "false", "running": "false"}
    menus = {**MENUS, "interfaces": [i for i in INTERFACES if i["name"] != "hall-5g"] + [quiet], "registrations": []}
    radios = build_wifi(menus, MACS, DEVICE_IDS, lambda mac: ClientHints())["radios"]
    home = next(r for r in radios if r["ssid"] == "Home")
    assert home == {"apId": "[02:AA:00:00:00:01]", "ssid": "Home", "band": "5", "channel": 5745, "state": "running"}


def test_slave_takes_its_masters_current_state() -> None:
    master = {"name": "yard-2g", "mac-address": "02:AA:00:00:02:01", "master-interface": "none",
              "configuration": "cfg-things", "current-channel": "2462/20/gn(20dBm)",
              "current-state": "running-ap", "disabled": "false", "running": "false"}
    slave = {"name": "yard-2g-1", "mac-address": "06:AA:00:00:02:01", "master-interface": "yard-2g",
             "configuration": "cfg-guests", "disabled": "false", "running": "false"}
    menus = {**MENUS, "interfaces": [i for i in INTERFACES if i["name"] != "yard-2g"] + [master, slave],
             "registrations": []}
    radios = build_wifi(menus, MACS, DEVICE_IDS, lambda mac: ClientHints())["radios"]
    guests = next(r for r in radios if r["apId"] == "[02:AA:00:00:00:02]" and r["ssid"] == "Guests")
    assert guests == {"apId": "[02:AA:00:00:00:02]", "ssid": "Guests", "band": "2.4", "channel": 2462, "state": "running"}


def test_radio_state_rules() -> None:
    assert radio_state({"disabled": "true", "current-state": "running-ap"}, {}) == "disabled"
    assert radio_state({}, {"disabled": "true"}) == "disabled"  # the master is disabled
    assert radio_state({"current-state": "running-ap", "running": "false"}, {}) == "running"
    assert radio_state({"running": "true"}, {}) == "running"
    assert radio_state({"current-state": "searching", "running": "false"}, {}) == "down"
    assert radio_state({"running": "false"}, {"current-state": "running-ap"}) == "running"  # slave
    assert radio_state({"current-state": "disabled", "running": "false"}, {"current-state": "running-ap"}) == "down"


def test_client_naming_order_and_fields() -> None:
    clients = {c["mac"]: c for c in build()["clients"]}
    # NetBox device first (also its id), then the lease comment, then the host name, then the MAC.
    assert clients["02:BB:00:00:00:01"]["name"] == "plug-one" and clients["02:BB:00:00:00:01"]["deviceId"] == "81"
    assert clients["02:BB:00:00:00:03"]["name"] == "Kitchen sensor"
    assert clients["02:BB:00:00:00:02"]["name"] == "guest-phone"
    assert clients["02:BB:00:00:00:04"]["name"] == "02:BB:00:00:00:04"
    one = clients["02:BB:00:00:00:01"]
    assert one == {"apId": "[02:AA:00:00:00:01]", "ssid": "Things", "band": "2.4", "mac": "02:BB:00:00:00:01", "name": "plug-one",
                   "deviceId": "81", "ip": "192.0.2.11", "signal": -61, "uptime": "1d02:03:04"}
    assert clients["02:BB:00:00:00:02"]["ip"] is None and clients["02:BB:00:00:00:02"]["uptime"] == "5m3s"
    assert clients["02:BB:00:00:00:05"]["signal"] is None and clients["02:BB:00:00:00:05"]["uptime"] is None


def test_lease_ip_wins_over_last_ip_and_last_ip_is_the_fallback() -> None:
    no_hints = build_wifi(MENUS, MACS, DEVICE_IDS, lambda mac: ClientHints())
    assert next(c for c in no_hints["clients"] if c["mac"] == "02:BB:00:00:00:01")["ip"] == "192.0.2.201"


def test_no_security_data_in_the_payload() -> None:
    text = repr(build())
    assert "passphrase" not in text and "prof-home" not in text and "security" not in text


def test_band_and_uptime_helpers() -> None:
    assert band_of(2412) == "2.4" and band_of(5745) == "5"
    assert band_of(None, "2G-IoT-Auto") == "2.4" and band_of(None, None, "5ghz-a/n/ac") == "5"
    assert band_of(None, "plain") is None
    assert uptime_text("4w2d20:23:23.960") == "4w2d20:23:23" and uptime_text("") is None


# ---- reading and the source ----------------------------------------------------------


class FakeConnection:
    def __init__(self, script: list[Reply]) -> None:
        self.script = script
        self.sent: list[list[str]] = []
        self.closed = False

    def send(self, words: list[str]) -> None:
        self.sent.append(list(words))

    async def replies(self) -> AsyncIterator[Reply]:
        for reply in self.script:
            yield reply

    async def close(self) -> None:
        self.closed = True


def _script(menus: dict) -> list[Reply]:
    replies = [Reply("!re", key, row) for key, rows in menus.items() for row in rows]
    return replies + [Reply("!done", key) for key in menus]


async def test_reads_the_six_menus_on_one_connection_and_never_security() -> None:
    conn = FakeConnection(_script(MENUS))
    menus = await read_menus(conn)  # type: ignore[arg-type]
    assert {k: len(v) for k, v in menus.items()} == {k: len(v) for k, v in MENUS.items()}
    paths = [words[0] for words in conn.sent]
    assert paths == ["/caps-man/interface/print", "/caps-man/configuration/print", "/caps-man/datapath/print",
                     "/caps-man/remote-cap/print", "/caps-man/radio/print", "/caps-man/registration-table/print"]
    assert not any("security" in w for words in conn.sent for w in words)


async def test_source_publishes_the_snapshot() -> None:
    conn = FakeConnection(_script(MENUS))

    async def connect():
        return conn

    source = WifiSource(connect, lambda mac: HINTS.get(mac, ClientHints()))
    source.set_macs(MACS)
    source.set_device_ids(DEVICE_IDS)
    events: list[dict] = []
    source.attach(events.append)
    await source.cycle()
    assert events[0]["type"] == "data" and len(events[0]["data"]["clients"]) == 5
    assert events[1]["type"] == "status" and events[1]["state"] == "live" and events[1]["error"] is None
    assert conn.closed


async def test_missing_capsman_gives_an_empty_snapshot_and_a_wifi_error() -> None:
    good = FakeConnection(_script(MENUS))
    bad = FakeConnection([Reply("!trap", "interfaces", {"message": "no such command prefix"})])
    connections = [good, bad]

    async def connect():
        return connections.pop(0)

    source = WifiSource(connect, lambda mac: ClientHints())
    events: list[dict] = []
    source.attach(events.append)
    await source.cycle()
    await source.cycle()
    assert events[-2] == {"type": "data", "data": EMPTY}
    assert events[-1]["state"] == "error"
    assert events[-1]["error"] == "Wi-Fi: /caps-man/interface no such command prefix"
    assert bad.closed


async def test_unreachable_router_is_reported_with_the_prefix() -> None:
    async def connect():
        raise OSError("cannot connect to 192.0.2.1:8728")

    source = WifiSource(connect, lambda mac: ClientHints())
    events: list[dict] = []
    source.attach(events.append)
    await source.cycle()
    assert events[0] == {"type": "data", "data": EMPTY}
    assert events[1]["state"] == "error" and events[1]["error"].startswith("Wi-Fi: ")
    await asyncio.sleep(0)


async def test_new_netbox_data_triggers_a_cycle_while_running() -> None:
    async def connect():
        return FakeConnection(_script(MENUS))

    source = WifiSource(connect, lambda mac: ClientHints(), period_s=3600)
    events: list[dict] = []
    source.attach(events.append)
    task = asyncio.create_task(source.run())
    for _ in range(50):
        if source.cycles:
            break
        await asyncio.sleep(0.01)
    first = [e for e in events if e["type"] == "data"][-1]["data"]
    assert next(a for a in first["aps"] if a["name"] == "ap-yard")["deviceId"] is None
    source.set_device_ids(DEVICE_IDS)  # the inventory cycle hands in device names
    for _ in range(50):
        if source.cycles >= 2:
            break
        await asyncio.sleep(0.01)
    task.cancel()
    latest = [e for e in events if e["type"] == "data"][-1]["data"]
    assert next(a for a in latest["aps"] if a["name"] == "ap-yard")["deviceId"] == "72"
