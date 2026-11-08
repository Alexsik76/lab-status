"""Minimal asyncio client for the RouterOS binary API (port 8728).

Only what the backend needs: login, sending tagged commands, and reading the
reply stream. Tagging lets `listen` and `print` share one connection; closing
the connection is how a running `listen` is stopped.
"""

import asyncio
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass, field


class RouterOsError(Exception):
    """Login failure, a `!trap`/`!fatal` reply, or a broken connection."""


def encode_length(n: int) -> bytes:
    if n < 0x80:
        return bytes([n])
    if n < 0x4000:
        return (n | 0x8000).to_bytes(2, "big")
    if n < 0x200000:
        return (n | 0xC00000).to_bytes(3, "big")
    if n < 0x10000000:
        return (n | 0xE0000000).to_bytes(4, "big")
    return b"\xf0" + n.to_bytes(4, "big")


def encode_sentence(words: Iterable[str]) -> bytes:
    out = bytearray()
    for word in words:
        raw = word.encode()
        out += encode_length(len(raw)) + raw
    out += b"\x00"
    return bytes(out)


async def read_length(reader: asyncio.StreamReader) -> int:
    first = (await reader.readexactly(1))[0]
    if first < 0x80:
        return first
    if first < 0xC0:
        return ((first & 0x3F) << 8) | (await reader.readexactly(1))[0]
    if first < 0xE0:
        return ((first & 0x1F) << 16) | int.from_bytes(await reader.readexactly(2), "big")
    if first < 0xF0:
        return ((first & 0x0F) << 24) | int.from_bytes(await reader.readexactly(3), "big")
    if first == 0xF0:
        return int.from_bytes(await reader.readexactly(4), "big")
    raise RouterOsError(f"unexpected control byte 0x{first:02x}")


async def read_sentence(reader: asyncio.StreamReader) -> list[str]:
    words: list[str] = []
    while True:
        length = await read_length(reader)
        if length == 0:
            return words
        words.append((await reader.readexactly(length)).decode("utf-8", errors="replace"))


@dataclass
class Reply:
    """One parsed sentence: reply word (`!re`, `!done`, `!trap`, `!fatal`), tag, attributes."""

    word: str
    tag: str | None = None
    attrs: dict[str, str] = field(default_factory=dict)


def parse_sentence(words: list[str]) -> Reply:
    reply = Reply(word=words[0] if words else "")
    for word in words[1:]:
        if word.startswith(".tag="):
            reply.tag = word[5:]
        elif word.startswith("="):
            key, _, value = word[1:].partition("=")
            reply.attrs[key] = value
        elif reply.word == "!fatal":
            reply.attrs.setdefault("message", word)
    return reply


class RouterOsConnection:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self._reader = reader
        self._writer = writer

    @classmethod
    async def open(
        cls, host: str, port: int, username: str, password: str, timeout: float = 10.0
    ) -> "RouterOsConnection":
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
        except (OSError, TimeoutError) as exc:
            raise RouterOsError(f"cannot connect to {host}:{port}: {exc}") from exc
        conn = cls(reader, writer)
        try:
            await asyncio.wait_for(conn._login(username, password), timeout)
        except BaseException:
            await conn.close()
            raise
        return conn

    async def _login(self, username: str, password: str) -> None:
        self.send(["/login", f"=name={username}", f"=password={password}"])
        try:
            reply = parse_sentence(await read_sentence(self._reader))
        except (asyncio.IncompleteReadError, OSError) as exc:
            raise RouterOsError("connection closed during login") from exc
        if reply.word != "!done":
            raise RouterOsError(f"login failed: {reply.attrs.get('message', reply.word)}")

    def send(self, words: Iterable[str]) -> None:
        self._writer.write(encode_sentence(words))

    async def replies(self) -> AsyncIterator[Reply]:
        """Yields replies until the connection breaks (raised as `RouterOsError`)."""
        while True:
            try:
                words = await read_sentence(self._reader)
            except (asyncio.IncompleteReadError, OSError) as exc:
                raise RouterOsError("connection to the router was closed") from exc
            if words:
                yield parse_sentence(words)

    async def close(self) -> None:
        self._writer.close()
        try:
            await self._writer.wait_closed()
        except (OSError, asyncio.CancelledError):
            pass
