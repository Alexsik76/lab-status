"""The `inventory` source: the backend's only reader of NetBox (and of Nginx Proxy Manager).

One cycle reads everything the backend needs, concurrently:

| part          | upstream reads                                   | used by                  |
|---------------|--------------------------------------------------|--------------------------|
| `inventory`   | NetBox GraphQL (the page's query)                | the page (stream payload) |
| `targets`     | REST services, virtual machines, devices         | `ServiceChecker`          |
| `macs`        | REST MAC addresses, devices, virtual machines    | `ArpSource` enrichment    |
| `public_urls` | NPM proxy hosts                                  | `ServiceChecker`          |

Each REST list is read once per cycle even when two parts need it. A part whose reads fail
keeps its previous value. When the page's inventory fails the cycle is an error (no new
payload); when only other parts fail the payload is still published and the status carries
`state: "live"` with `error` naming the failure.
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from .netbox import MacMatch, NetBoxClient, Target, build_mac_directory, build_targets
from .npm import NpmClient, PublicUrlMap, fetch_public_url_map
from .polling import PollingSource

log = logging.getLogger(__name__)

Json = dict[str, Any]

#: The page's NetBox GraphQL query (moved here from the browser; same text).
INVENTORY_QUERY = """{
  device_list { id name status role { slug } device_type { model manufacturer { name } }
    primary_ip4 { address } cluster { name } platform { name custom_fields } tags { name color } custom_fields }
  virtual_machine_list { id name status vcpus memory disk description
    virtual_machine_type { name } cluster { name } device { id name } platform { name custom_fields }
    primary_ip4 { address } tags { name color } custom_fields }
  service_list { id name ports custom_fields ipaddresses { address }
    parent { __typename ... on VirtualMachineType { id } ... on DeviceType { id } } }
}"""

INVENTORY_LISTS = ("device_list", "virtual_machine_list", "service_list")


class InventoryUnavailable(Exception):
    """No part of the requested kind has ever been loaded."""


class UpstreamError(Exception):
    """A failed read, with the message shown on the page."""


def describe(system: str, exc: BaseException) -> str:
    if isinstance(exc, UpstreamError):
        return str(exc)
    if isinstance(exc, httpx.TimeoutException):
        return f"{system} did not respond in time."
    if isinstance(exc, httpx.HTTPStatusError):
        response = exc.response
        return f"{system} responded with HTTP {response.status_code} {response.reason_phrase}.".replace(" .", ".")
    if isinstance(exc, httpx.HTTPError):
        return f"{system} is unreachable."
    return f"{system} returned an unexpected response ({type(exc).__name__}: {exc})."


async def fetch_inventory(netbox: NetBoxClient) -> Json:
    """The GraphQL `data` object of the page's query, validated as the browser did."""
    body = await netbox.graphql(INVENTORY_QUERY)
    errors = body.get("errors") if isinstance(body, dict) else None
    if errors:
        messages = "; ".join(str(e.get("message", e)) if isinstance(e, dict) else str(e) for e in errors)
        raise UpstreamError(f"NetBox rejected the query: {messages}")
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, dict) or not all(isinstance(data.get(k), list) for k in INVENTORY_LISTS):
        raise UpstreamError("NetBox returned an unexpected response (inventory data is missing).")
    return data


@dataclass
class InventoryParts:
    """The shared result of the inventory cycles; each part keeps its last good value
    (None until it first loads)."""

    inventory: Json | None = None
    targets: list[Target] | None = None
    macs: dict[str, MacMatch] | None = None
    public_urls: PublicUrlMap | None = None
    #: Messages of the parts that failed in the last cycle, by part name.
    errors: dict[str, str] = field(default_factory=dict)


class InventorySource(PollingSource):
    def __init__(
        self,
        netbox: NetBoxClient,
        npm: NpmClient | None,
        netbox_public_url: str = "",
        period_s: float = 300.0,
        resolve: Callable[[str], Any] | None = None,
    ) -> None:
        super().__init__("inventory", period_s)
        self._netbox = netbox
        self._npm = npm
        self._public_url = netbox_public_url
        self._resolve = resolve
        self.parts = InventoryParts()
        #: Called with the new directory whenever the MAC directory changed.
        self.on_macs_changed: list[Callable[[dict[str, MacMatch]], None]] = []
        #: Called after every cycle (successful or not) with the shared parts.
        self.on_cycle: list[Callable[[InventoryParts], None]] = []

    # ---- cycle ----

    async def fetch(self) -> Json:
        reads: dict[str, Any] = {
            "inventory": fetch_inventory(self._netbox),
            "services": self._netbox.list("ipam/services/"),
            "vms": self._netbox.list("virtualization/virtual-machines/"),
            "devices": self._netbox.list("dcim/devices/"),
            "mac_addresses": self._netbox.list("dcim/mac-addresses/"),
        }
        if self._npm is not None:
            args = (self._npm,) if self._resolve is None else (self._npm, self._resolve)
            reads["public_urls"] = fetch_public_url_map(*args)
        results = dict(zip(reads, await asyncio.gather(*reads.values(), return_exceptions=True), strict=True))
        for value in results.values():
            if isinstance(value, asyncio.CancelledError):
                raise value

        errors: dict[str, str] = {}

        def ok(*names: str) -> bool:
            failed = [n for n in names if isinstance(results[n], BaseException)]
            return not failed

        def first_error(*names: str) -> BaseException:
            return next(results[n] for n in names if isinstance(results[n], BaseException))

        if ok("services", "vms", "devices"):
            self.parts.targets = build_targets(results["services"], results["vms"], results["devices"])
        else:
            errors["targets"] = describe("NetBox", first_error("services", "vms", "devices"))

        if ok("mac_addresses", "devices", "vms"):
            macs = build_mac_directory(results["mac_addresses"], results["devices"], results["vms"], self._public_url)
            if macs != self.parts.macs:
                self.parts.macs = macs
                for callback in self.on_macs_changed:
                    callback(macs)
        else:
            errors["macs"] = describe("NetBox", first_error("mac_addresses", "devices", "vms"))

        if "public_urls" in results:
            if ok("public_urls"):
                self.parts.public_urls = results["public_urls"]
            else:
                errors["public_urls"] = describe("Nginx Proxy Manager", results["public_urls"])

        if ok("inventory"):
            self.parts.inventory = results["inventory"]
        else:
            errors["inventory"] = describe("NetBox", results["inventory"])
        self.parts.errors = errors
        for callback in self.on_cycle:
            callback(self.parts)
        if "inventory" in errors:
            raise UpstreamError(self._summary())
        return self.parts.inventory

    def cycle_warning(self) -> str | None:
        return self._summary() or None

    def _summary(self) -> str:
        """Each distinct message once, the page's inventory first."""
        order = ("inventory", "targets", "macs", "public_urls")
        return " ".join(dict.fromkeys(self.parts.errors[p] for p in order if p in self.parts.errors))

    # ---- readers without a subscription ----

    async def load_targets(self) -> list[Target]:
        await self.ensure_fresh()
        if self.parts.targets is None:
            raise InventoryUnavailable(self.parts.errors.get("targets") or "NetBox is unreachable.")
        return self.parts.targets

    async def load_public_urls(self) -> PublicUrlMap:
        await self.ensure_fresh()
        return self.parts.public_urls or {}
