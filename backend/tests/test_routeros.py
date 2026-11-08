import asyncio

import pytest

from app.routeros import encode_length, encode_sentence, parse_sentence, read_length, read_sentence


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
