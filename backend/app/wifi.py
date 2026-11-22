"""The `wifi` source: wireless networks, access points, radios and clients from the router's
legacy CAPsMAN, polled over the RouterOS API (same connection settings as the ARP mirror).

Six menus are read, each with `print`, on one short session per cycle:
`/caps-man/interface`, `/caps-man/configuration`, `/caps-man/datapath`, `/caps-man/remote-cap`,
`/caps-man/radio`, `/caps-man/registration-table`. `/caps-man/security` is never read, and no
passphrase or security profile leaves this module: `build_wifi` copies only the fields below.

    {"networks": [{"ssid", "band": "2.4" | "5" | null, "vlan"}],
     "aps":      [{"id", "name", "deviceId"}],
     "radios":   [{"apId", "ssid", "band", "channel", "state": "running" | "disabled" | "down"}],
     "clients":  [{"apId", "ssid", "band", "mac", "name", "deviceId", "ip", "signal", "uptime"}]}

`band` on a client (its radio's band) is beyond the brief's shape: an SSID broadcast on both
bands by one AP needs it to put the client in the right row.

A failed read (no CAPsMAN on the router, a missing permission, the router unreachable) gives an
empty snapshot and a status error starting with "Wi-Fi: "; nothing else depends on this source.
"""

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable
from typing import Any

from .arp import ClientHints
from .netbox import MacMatch
from .polling import PollingSource
from .routeros import RouterOsConnection, RouterOsError

log = logging.getLogger(__name__)

Json = dict[str, Any]
Rows = list[dict[str, str]]

#: Live wireless state is polled like the other live sources (Proxmox guest states: 15 s).
WIFI_PERIOD_S = 15.0
ERROR_PREFIX = "Wi-Fi: "

MENUS = {
    "interfaces": "/caps-man/interface",
    "configurations": "/caps-man/configuration",
    "datapaths": "/caps-man/datapath",
    "caps": "/caps-man/remote-cap",
    "radios": "/caps-man/radio",
    "registrations": "/caps-man/registration-table",
}

EMPTY: Json = {"networks": [], "aps": [], "radios": [], "clients": []}


def _flag(value: str | None) -> bool:
    return value in ("true", "yes")


def _int(value: str | None) -> int | None:
    match = re.match(r"\s*(-?\d+)", value or "")
    return int(match.group(1)) if match else None


def _mac(value: str | None) -> str:
    return (value or "").strip().upper()


def band_of(channel_mhz: int | None, *names: str | None) -> str | None:
    """2.4 or 5 GHz from the frequency; without one (a disabled radio) from the configuration or
    channel profile name (`2G-...`, `5ghz-...`)."""
    if channel_mhz:
        if 2400 <= channel_mhz < 2500:
            return "2.4"
        if 4900 <= channel_mhz < 6000:
            return "5"
    for name in names:
        text = (name or "").lower()
        if re.search(r"(^|[^0-9.])2(\.4)?g", text):
            return "2.4"
        if re.search(r"(^|[^0-9])5g", text):
            return "5"
    return None


def uptime_text(value: str | None) -> str | None:
    """RouterOS duration without its fraction of a second: `4w2d20:23:23.960` -> `4w2d20:23:23`,
    `1d3h2m5s120ms` -> `1d3h2m5s`."""
    if not value:
        return None
    return re.sub(r"(\.\d+|\d+ms)$", "", value)


def radio_state(row: dict[str, str], master: dict[str, str]) -> str:
    """`disabled` when the interface or its master is disabled; `running` when CAPsMAN reports
    it broadcasting (`current-state` `running-ap` and the like; a slave without its own takes its
    master's), whatever the `running` flag says (it is off on an AP with no clients); else the
    `running` flag decides between `running` and `down`."""
    if _flag(row.get("disabled")) or _flag(master.get("disabled")):
        return "disabled"
    current = row.get("current-state") or master.get("current-state") or ""
    if current.startswith("running"):
        return "running"
    return "running" if _flag(row.get("running")) else "down"


def build_wifi(
    menus: dict[str, Rows],
    macs: dict[str, MacMatch],
    device_ids: dict[str, str],
    hints: Callable[[str], ClientHints],
) -> Json:
    """The `wifi` snapshot from the six CAPsMAN menus.

    - A slave (virtual) interface belongs to its master's radio: same AP, same channel and
      band, its own SSID.
    - SSID -> VLAN: configuration -> datapath -> `vlan-id` (an inline `datapath.vlan-id` wins).
    - AP -> NetBox device: a CAP / radio / interface MAC in the NetBox MAC directory, else a
      NetBox device named like the CAP identity, else none (name = identity).
    - Client name: the NetBox object owning its MAC, else the DHCP lease comment, else the
      lease host name, else the MAC. IP from the lease / ARP row, else the CAP's `last-ip`.
    """
    interfaces = {row.get("name", ""): row for row in menus.get("interfaces", [])}
    configs = {row.get("name", ""): row for row in menus.get("configurations", [])}
    datapaths = {row.get("name", ""): row for row in menus.get("datapaths", [])}
    caps = {row.get("name", ""): row for row in menus.get("caps", [])}
    radio_by_master = {row.get("interface", ""): row for row in menus.get("radios", [])}

    # ---- access points ----
    aps: dict[str, Json] = {}
    for cap_name, cap in caps.items():
        identity = cap.get("identity") or cap_name
        cap_macs = {_mac(cap.get("base-mac"))}
        for radio in menus.get("radios", []):
            if radio.get("remote-cap-name") == cap_name:
                cap_macs.add(_mac(radio.get("radio-mac")))
                master = interfaces.get(radio.get("interface", ""), {})
                cap_macs.add(_mac(master.get("mac-address")))
        matches = [macs[m] for m in sorted(cap_macs) if m and m in macs and macs[m].kind == "device"]
        if matches:
            device_id, name = matches[0].id, matches[0].name
        elif identity in device_ids:
            device_id, name = device_ids[identity], identity
        else:
            device_id, name = None, identity
        aps[cap_name] = {"id": cap_name, "name": name, "deviceId": device_id}

    # ---- radios (one per interface, slaves on their master's radio) ----
    def master_of(row: dict[str, str]) -> dict[str, str]:
        master = row.get("master-interface")
        return interfaces.get(master, row) if master and master != "none" else row

    def config_of(row: dict[str, str]) -> dict[str, str]:
        return configs.get(row.get("configuration", ""), {})

    def vlan_of(config: dict[str, str]) -> int | None:
        inline = _int(config.get("datapath.vlan-id"))
        if inline is not None:
            return inline
        return _int(datapaths.get(config.get("datapath", ""), {}).get("vlan-id"))

    radios: list[Json] = []
    ap_of_interface: dict[str, str] = {}
    band_of_interface: dict[str, str | None] = {}
    networks: dict[tuple[str, str | None], Json] = {}
    for name, row in interfaces.items():
        master = master_of(row)
        radio = radio_by_master.get(master.get("name", ""))
        if radio is None or radio.get("remote-cap-name") not in aps:
            continue
        ap_id = radio["remote-cap-name"]
        ap_of_interface[name] = ap_id
        config = config_of(row)
        ssid = config.get("ssid") or row.get("configuration.ssid") or ""
        if not ssid:
            continue
        channel = _int(master.get("current-channel"))
        band = band_of(channel, config.get("channel"), config.get("name"), config_of(master).get("channel"),
                       config_of(master).get("name"), master.get("name"))
        band_of_interface[name] = band
        state = radio_state(row, master)
        radios.append({"apId": ap_id, "ssid": ssid, "band": band, "channel": channel, "state": state})
        key = (ssid, band)
        vlan = vlan_of(config)
        if key not in networks or (networks[key]["vlan"] is None and vlan is not None):
            networks[key] = {"ssid": ssid, "band": band, "vlan": vlan}

    # ---- clients ----
    clients: list[Json] = []
    for reg in menus.get("registrations", []):
        ap_id = ap_of_interface.get(reg.get("interface", ""))
        if ap_id is None:
            continue
        mac = _mac(reg.get("mac-address"))
        interface = interfaces.get(reg.get("interface", ""), {})
        ssid = reg.get("ssid") or config_of(interface).get("ssid") or ""
        match = macs.get(mac)
        hint = hints(mac) if mac else ClientHints()
        name = (match.name if match else None) or hint.lease_comment or hint.lease_host_name or mac
        clients.append({
            "apId": ap_id,
            "ssid": ssid,
            "band": band_of_interface.get(reg.get("interface", "")),
            "mac": mac,
            "name": name,
            "deviceId": match.id if match and match.kind == "device" else None,
            "ip": hint.ip or reg.get("last-ip") or None,
            "signal": _int(reg.get("rx-signal")),
            "uptime": uptime_text(reg.get("uptime")),
        })

    band_order = {"2.4": 0, "5": 1, None: 2}
    return {
        "networks": sorted(networks.values(), key=lambda n: (n["ssid"].lower(), band_order[n["band"]])),
        "aps": sorted(aps.values(), key=lambda a: a["name"].lower()),
        "radios": sorted(radios, key=lambda r: (r["apId"], r["ssid"].lower(), band_order[r["band"]])),
        "clients": sorted(clients, key=lambda c: (c["apId"], c["ssid"].lower(), c["name"].lower())),
    }


async def read_menus(conn: RouterOsConnection) -> dict[str, Rows]:
    """`print` of the six menus on one connection; a `!trap` (e.g. no CAPsMAN) raises."""
    rows: dict[str, Rows] = {key: [] for key in MENUS}
    for key, path in MENUS.items():
        words = [f"{path}/print", f".tag={key}"]
        if key == "registrations":
            words.insert(1, "=stats=")
        conn.send(words)
    pending = set(MENUS)
    async for reply in conn.replies():
        if reply.word in ("!trap", "!fatal"):
            path = MENUS.get(reply.tag or "", "")
            raise RouterOsError(f"{path} {reply.attrs.get('message', reply.word)}".strip())
        if reply.word == "!re" and reply.tag in rows:
            rows[reply.tag].append(dict(reply.attrs))
        elif reply.word == "!done" and reply.tag in pending:
            pending.discard(reply.tag)
            if not pending:
                break
    return rows


class WifiSource(PollingSource):
    def __init__(
        self,
        connect: Callable[[], Awaitable[RouterOsConnection]],
        hints: Callable[[str], ClientHints],
        period_s: float = WIFI_PERIOD_S,
    ) -> None:
        super().__init__("wifi", period_s)
        self._connect = connect
        self._hints = hints
        self._macs: dict[str, MacMatch] = {}
        self._device_ids: dict[str, str] = {}

    def set_macs(self, macs: dict[str, MacMatch]) -> None:
        """A new NetBox MAC directory: re-read at once, so names and links follow it."""
        if macs != self._macs:
            self._macs = macs
            self.refresh()

    def set_device_ids(self, device_ids: dict[str, str] | None) -> None:
        if device_ids is not None and device_ids != self._device_ids:
            self._device_ids = device_ids
            self.refresh()

    async def fetch(self) -> Json:
        try:
            conn = await self._connect()
            try:
                menus = await asyncio.wait_for(read_menus(conn), 20.0)
            finally:
                await conn.close()
        except asyncio.CancelledError:
            raise
        except Exception:
            # The page shows no Wi-Fi rather than a stale one.
            if not self.has_data or self.data != EMPTY:
                self.data, self.has_data = EMPTY, True
                self.publish(self._data_event())
            raise
        return build_wifi(menus, self._macs, self._device_ids, self._hints)

    def describe_error(self, exc: Exception) -> str:
        if isinstance(exc, TimeoutError):
            return f"{ERROR_PREFIX}the router did not answer in time."
        return f"{ERROR_PREFIX}{exc}" if str(exc) else f"{ERROR_PREFIX}{type(exc).__name__}"
