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
    assert conn.sent == [["/ip/arp/listen", ".tag=listen"], ["/ip/arp/print", ".tag=print"]]

    hub.unsubscribe(queue)
    await asyncio.sleep(0.05)
    assert conn.closed
    assert hub.state == "idle"


async def test_second_subscriber_gets_snapshot_immediately() -> None:
    conn = FakeConnection([Reply("!re", "print", _attrs("*1", "permanent")), Reply("!done", "print")])

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
