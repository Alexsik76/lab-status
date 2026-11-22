import asyncio
import socket

import pytest

from app.routeros import RouterOsConnection, RouterOsError, describe, encode_length, encode_sentence, parse_sentence, read_length, read_sentence


def _reader(data: bytes) -> asyncio.StreamReader:
    reader = asyncio.StreamReader()
    reader.feed_data(data)
    reader.feed_eof()
    return reader


@pytest.mark.parametrize("n", [0, 1, 0x7F, 0x80, 0x3FFF, 0x4000, 0x1FFFFF, 0x200000, 0xFFFFFFF, 0x10000000])
async def test_length_roundtrip(n: int) -> None:
    assert await read_length(_reader(encode_length(n))) == n


async def test_sentence_roundtrip() -> None:
    words = ["/ip/arp/listen", ".tag=listen", "=x=" + "y" * 300]
    assert await read_sentence(_reader(encode_sentence(words))) == words


def test_parse_reply_with_tag_and_attrs() -> None:
    reply = parse_sentence(["!re", ".tag=listen", "=.id=*2A", "=mac-address=02:00:00:00:00:01", "=comment=a=b"])
    assert reply.word == "!re"
    assert reply.tag == "listen"
    assert reply.attrs == {".id": "*2A", "mac-address": "02:00:00:00:00:01", "comment": "a=b"}


def test_parse_fatal_message() -> None:
    assert parse_sentence(["!fatal", "session terminated"]).attrs["message"] == "session terminated"


def _closed_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def test_a_failed_connect_keeps_the_address_out_of_the_message() -> None:
    port = _closed_port()
    with pytest.raises(RouterOsError) as info:
        await RouterOsConnection.open("127.0.0.1", port, "user", "pw", timeout=1)
    assert str(info.value) == "cannot connect to the router"
    assert info.value.detail and info.value.detail.startswith(f"127.0.0.1:{port}: ")


def test_describe_gives_short_messages_without_the_exception_text() -> None:
    assert describe(RouterOsError("the router rejected the login", "invalid user name or password (6)")) == (
        "the router rejected the login"
    )
    assert describe(TimeoutError()) == "the router did not answer in time"
    assert describe(OSError("[Errno 113] No route to host 192.0.2.1")) == "the router is unreachable"
    assert describe(ValueError("192.0.2.1 something")) == "unexpected error (ValueError)"
