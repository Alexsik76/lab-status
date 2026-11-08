import asyncio
from collections.abc import AsyncIterator

from app.arp import ArpHub, presence
from app.netbox import MacMatch
from app.routeros import Reply

MATCH = MacMatch("device", "1", "srv-a", "Server", "active", "", "eth0", None)


def _attrs(id_: str, status: str, mac: str = "02:00:00:00:00:AA", address: str = "192.0.2.10") -> dict[str, str]:
    return {".id": id_, "address": address, "mac-address": mac, "interface": "vlan10",
            "status": status, "dhcp": "false", "dynamic": "true", "disabled": "false"}


class FakeConnection:
    def __init__(self, script: list[Reply]) -> None:
        self.script = script
        self.sent: list[list[str]] = []
        self.closed = False
        self.release = asyncio.Event()

    def send(self, words: list[str]) -> None:
        self.sent.append(list(words))

    async def replies(self) -> AsyncIterator[Reply]:
        for reply in self.script:
            yield reply
        await self.release.wait()  # keep the session open like a real `listen`

    async def close(self) -> None:
        self.closed = True


def test_presence_classes() -> None:
    assert [presence(s) for s in ("reachable", "stale", "delay", "probe", "permanent")] == ["active"] * 5
    assert [presence(s) for s in ("failed", "incomplete")] == ["disconnected"] * 2
    assert presence("") == "unknown"


async def _drain(queue: asyncio.Queue, until: str) -> list[dict]:
    events = []
    while True:
        event = await asyncio.wait_for(queue.get(), 2)
        events.append(event)
        if event["type"] == until:
            return events


async def test_session_snapshot_then_live_events() -> None:
    conn = FakeConnection([
        Reply("!re", "print", _attrs("*1", "reachable")),
        Reply("!re", "print", _attrs("*2", "failed", mac="02:00:00:00:00:BB", address="192.0.2.11")),
        Reply("!done", "print"),
        Reply("!done", "lease-print"),
        Reply("!re", "listen", _attrs("*1", "stale")),
        Reply("!re", "listen", {".id": "*2", ".dead": "true"}),
    ])

    async def connect():
        return conn

    async def load_macs():
        return {"02:00:00:00:00:AA": MATCH}

    hub = ArpHub(connect, load_macs)
    queue = hub.subscribe()
    events = await _drain(queue, "snapshot")
    snapshot = events[-1]["rows"]
    assert {r["id"]: r["presence"] for r in snapshot} == {"*1": "active", "*2": "disconnected"}
    assert next(r for r in snapshot if r["id"] == "*1")["netbox"]["name"] == "srv-a"
    assert next(r for r in snapshot if r["id"] == "*2")["netbox"] is None

    upsert = await asyncio.wait_for(queue.get(), 2)
    assert upsert["type"] == "upsert" and upsert["row"]["status"] == "stale"
    remove = await asyncio.wait_for(queue.get(), 2)
    assert remove == {"type": "remove", "id": "*2"}
    assert conn.sent == [
        ["/ip/arp/listen", ".tag=listen"],
        ["/ip/dhcp-server/lease/listen", ".tag=lease-listen"],
        ["/ip/arp/print", ".tag=print"],
        ["/ip/dhcp-server/lease/print", ".tag=lease-print"],
    ]

    hub.unsubscribe(queue)
    await asyncio.sleep(0.05)
    assert conn.closed
    assert hub.state == "idle"


async def test_second_subscriber_gets_snapshot_immediately() -> None:
    conn = FakeConnection([
        Reply("!re", "print", _attrs("*1", "permanent")),
        Reply("!done", "print"),
        Reply("!done", "lease-print"),
    ])

    async def connect():
        return conn

    async def load_macs():
        return {}

    hub = ArpHub(connect, load_macs)
    first = hub.subscribe()
    await _drain(first, "snapshot")
    second = hub.subscribe()
    events = await _drain(second, "snapshot")
    assert events[0] == {"type": "status", "state": "live", "error": None}
    assert events[-1]["rows"][0]["presence"] == "active"
    hub.unsubscribe(first)
    assert not conn.closed  # one page is still open
    hub.unsubscribe(second)
    await asyncio.sleep(0.05)
    assert conn.closed


def _lease(id_: str, address: str, mac: str, dynamic: bool = False, comment: str = "") -> dict[str, str]:
    attrs = {".id": id_, "address": address, "mac-address": mac, "dynamic": "true" if dynamic else "false"}
    if comment:
        attrs["comment"] = comment
    return attrs


async def test_entry_without_mac_borrows_the_static_lease_mac() -> None:
    printer = MacMatch("device", "9", "printer", "IoT", "active", "", "wlan0", None)
    conn = FakeConnection([
        Reply("!re", "lease-print", _lease("*L1", "192.0.2.50", "02:00:00:00:00:99", comment="Printer")),
        Reply("!re", "lease-print", _lease("*L2", "192.0.2.60", "02:00:00:00:00:77")),
        Reply("!re", "lease-print", _lease("*L3", "192.0.2.70", "02:00:00:00:00:66", dynamic=True)),
        Reply("!done", "lease-print"),
        Reply("!re", "print", {".id": "*1", "address": "192.0.2.50", "status": "failed"}),
        Reply("!re", "print", {".id": "*2", "address": "192.0.2.60", "status": "incomplete"}),
        Reply("!re", "print", {".id": "*3", "address": "192.0.2.70", "status": "failed"}),
        Reply("!done", "print"),
    ])

    async def connect():
        return conn

    async def load_macs():
        return {"02:00:00:00:00:99": printer}

    hub = ArpHub(connect, load_macs)
    queue = hub.subscribe()
    rows = {r["id"]: r for r in (await _drain(queue, "snapshot"))[-1]["rows"]}

    assert rows["*1"]["mac"] == "02:00:00:00:00:99" and rows["*1"]["macSource"] == "lease"
    assert rows["*1"]["netbox"]["name"] == "printer"
    # Static lease without a NetBox match: unknown, but the lease name is still shown.
    assert rows["*2"]["netbox"] is None and rows["*2"]["lease"] == {"name": None, "mac": "02:00:00:00:00:77"}
    # Dynamic leases are not used.
    assert rows["*3"]["mac"] == "" and rows["*3"]["lease"] is None
    hub.unsubscribe(queue)


def test_lease_changes_that_matter() -> None:
    hub = ArpHub(None, None)  # type: ignore[arg-type]
    assert hub.apply_lease(_lease("*L1", "192.0.2.50", "02:00:00:00:00:99")) is True
    assert hub.apply_lease(_lease("*L1", "192.0.2.50", "02:00:00:00:00:99")) is False
    assert hub.apply_lease(_lease("*D1", "192.0.2.70", "02:00:00:00:00:66", dynamic=True)) is False
    assert hub.apply_lease({".id": "*L1", ".dead": "true"}) is True
