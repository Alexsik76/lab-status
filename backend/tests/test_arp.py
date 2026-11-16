import asyncio
from collections.abc import AsyncIterator

from app.arp import ArpSource, presence
from app.hub import StreamHub
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


GRACE_S = 0.01


def _hub(connect, macs: dict) -> tuple[StreamHub, ArpSource]:
    """`macs` stands for the directory the inventory source hands in before the session."""
    source = ArpSource(connect)
    source.set_macs(macs)
    return StreamHub([source], grace_s=GRACE_S), source


async def _next(queue: asyncio.Queue) -> dict:
    name, event = await asyncio.wait_for(queue.get(), 2)
    assert name == "arp"
    return event


async def _drain(queue: asyncio.Queue, until: str) -> list[dict]:
    events = []
    while True:
        event = await _next(queue)
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

    macs = {"02:00:00:00:00:AA": MATCH}

    hub, source = _hub(connect, macs)
    queue = hub.subscribe()
    events = await _drain(queue, "snapshot")
    snapshot = events[-1]["rows"]
    assert {r["id"]: r["presence"] for r in snapshot} == {"*1": "active", "*2": "disconnected"}
    assert next(r for r in snapshot if r["id"] == "*1")["netbox"]["name"] == "srv-a"
    assert next(r for r in snapshot if r["id"] == "*2")["netbox"] is None

    upsert = await _next(queue)
    assert upsert["type"] == "upsert" and upsert["row"]["status"] == "stale"
    remove = await _next(queue)
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
    assert source.state == "idle"


async def test_second_subscriber_gets_snapshot_immediately() -> None:
    conn = FakeConnection([
        Reply("!re", "print", _attrs("*1", "permanent")),
        Reply("!done", "print"),
        Reply("!done", "lease-print"),
    ])

    async def connect():
        return conn

    macs = {}

    hub, _ = _hub(connect, macs)
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

    macs = {"02:00:00:00:00:99": printer}

    hub, _ = _hub(connect, macs)
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
    source = ArpSource(None)  # type: ignore[arg-type]
    assert source.apply_lease(_lease("*L1", "192.0.2.50", "02:00:00:00:00:99")) is True
    assert source.apply_lease(_lease("*L1", "192.0.2.50", "02:00:00:00:00:99")) is False
    assert source.apply_lease(_lease("*D1", "192.0.2.70", "02:00:00:00:00:66", dynamic=True)) is False
    assert source.apply_lease({".id": "*L1", ".dead": "true"}) is True


async def test_two_subscribers_share_one_router_session_until_grace_expires() -> None:
    connections: list[FakeConnection] = []

    async def connect():
        conn = FakeConnection([Reply("!done", "print"), Reply("!done", "lease-print")])
        connections.append(conn)
        return conn

    macs = {}

    source = ArpSource(connect)
    source.set_macs(macs)
    hub = StreamHub([source], grace_s=0.2)
    first, second = hub.subscribe(), hub.subscribe()
    await _drain(first, "snapshot")
    await _drain(second, "snapshot")
    assert len(connections) == 1

    # A page reload: the only subscriber leaves and comes back within the grace period.
    hub.unsubscribe(first)
    hub.unsubscribe(second)
    await asyncio.sleep(0.05)
    reloaded = hub.subscribe()
    events = await _drain(reloaded, "snapshot")
    assert events[0] == {"type": "status", "state": "live", "error": None}
    await asyncio.sleep(0.3)
    assert len(connections) == 1 and not connections[0].closed

    hub.unsubscribe(reloaded)
    await asyncio.sleep(0.1)
    assert not connections[0].closed  # still within the grace period
    await asyncio.sleep(0.2)
    assert connections[0].closed
    assert source.state == "idle" and hub.health()["sources"]["arp"] == {
        "running": False, "state": "idle", "error": None,
    }


async def test_new_mac_directory_re_sends_the_snapshot() -> None:
    conn = FakeConnection([
        Reply("!re", "print", _attrs("*1", "reachable")),
        Reply("!done", "print"),
        Reply("!done", "lease-print"),
    ])

    async def connect():
        return conn

    hub, source = _hub(connect, {})
    queue = hub.subscribe()
    rows = (await _drain(queue, "snapshot"))[-1]["rows"]
    assert rows[0]["netbox"] is None

    source.set_macs({"02:00:00:00:00:AA": MATCH})
    snapshot = await _next(queue)
    assert snapshot["type"] == "snapshot" and snapshot["rows"][0]["netbox"]["name"] == "srv-a"
    source.set_macs({"02:00:00:00:00:AA": MATCH})  # unchanged: nothing sent
    assert queue.empty()
    await hub.aclose()


def test_mac_directory_before_the_session_sends_nothing() -> None:
    source = ArpSource(None)  # type: ignore[arg-type]
    events: list[dict] = []
    source.attach(events.append)
    source.set_macs({"02:00:00:00:00:AA": MATCH})
    assert events == []


# ---- presence transitions (stage 5: they drive the service checks) ---------------------


async def _live_source(script_after_print: list[Reply]) -> tuple[StreamHub, ArpSource, list[tuple[str, str]], FakeConnection]:
    conn = FakeConnection([
        Reply("!re", "print", _attrs("*1", "reachable", mac="02:00:00:00:00:01", address="192.0.2.1")),
        Reply("!re", "print", _attrs("*2", "failed", mac="02:00:00:00:00:02", address="192.0.2.2")),
        Reply("!re", "print", _attrs("*3", "permanent", mac="02:00:00:00:00:03", address="192.0.2.3")),
        Reply("!done", "print"),
        Reply("!done", "lease-print"),
        *script_after_print,
    ])

    async def connect():
        return conn

    hub, source = _hub(connect, {})
    seen: list[tuple[str, str]] = []
    source.on_transition.append(lambda address, transition: seen.append((address, transition)))
    hub.subscribe()
    await asyncio.sleep(0.05)
    return hub, source, seen, conn


async def test_the_initial_table_produces_no_transitions() -> None:
    hub, _, seen, _ = await _live_source([])
    assert seen == []
    await hub.aclose()


async def test_reachable_stale_and_other_active_states_produce_nothing() -> None:
    hub, _, seen, _ = await _live_source([
        Reply("!re", "listen", _attrs("*1", "stale", mac="02:00:00:00:00:01", address="192.0.2.1")),
        Reply("!re", "listen", _attrs("*1", "delay", mac="02:00:00:00:00:01", address="192.0.2.1")),
        Reply("!re", "listen", _attrs("*1", "probe", mac="02:00:00:00:00:01", address="192.0.2.1")),
        Reply("!re", "listen", _attrs("*1", "reachable", mac="02:00:00:00:00:01", address="192.0.2.1")),
    ])
    assert seen == []
    await hub.aclose()


async def test_failed_removed_and_appeared() -> None:
    hub, _, seen, _ = await _live_source([
        Reply("!re", "listen", _attrs("*1", "failed", mac="02:00:00:00:00:01", address="192.0.2.1")),
        Reply("!re", "listen", _attrs("*1", "reachable", mac="02:00:00:00:00:01", address="192.0.2.1")),
        Reply("!re", "listen", {".id": "*1", ".dead": "true"}),  # removed while active
        Reply("!re", "listen", _attrs("*9", "reachable", mac="02:00:00:00:00:01", address="192.0.2.1")),
        Reply("!re", "listen", {".id": "*2", ".dead": "true"}),  # removed after failed: nothing
        Reply("!re", "listen", _attrs("*4", "incomplete", mac="", address="192.0.2.4")),  # new and failed
    ])
    assert seen == [
        ("192.0.2.1", "failed"),
        ("192.0.2.1", "appeared"),
        ("192.0.2.1", "removed"),
        ("192.0.2.1", "appeared"),
        ("192.0.2.4", "failed"),
    ]
    await hub.aclose()


async def test_a_second_row_for_an_active_address_changes_nothing() -> None:
    hub, _, seen, _ = await _live_source([
        Reply("!re", "listen", _attrs("*7", "reachable", mac="02:00:00:00:00:77", address="192.0.2.1")),
        Reply("!re", "listen", {".id": "*7", ".dead": "true"}),
    ])
    assert seen == []
    await hub.aclose()
