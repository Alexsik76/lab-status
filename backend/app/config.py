"""Settings read from the environment (stack environment in production, .env.local in development)."""

import os
from dataclasses import dataclass, field


def _csv(value: str | None) -> frozenset[str]:
    return frozenset(part.strip() for part in (value or "").split(",") if part.strip())


@dataclass(frozen=True)
class Settings:
    routeros_host: str = ""
    routeros_port: int = 8728
    routeros_user: str = ""
    routeros_password: str = ""
    netbox_url: str = ""
    netbox_token: str = ""
    #: Base URL of the NetBox web UI used for links on the page; links are omitted when empty.
    netbox_public_url: str = ""
    #: Service check names (`parent/service`) that are never checked.
    service_check_exclude: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ
        return cls(
            routeros_host=env.get("ROUTEROS_HOST", ""),
            routeros_port=int(env.get("ROUTEROS_PORT") or 8728),
            routeros_user=env.get("ROUTEROS_USER", ""),
            routeros_password=env.get("ROUTEROS_PASSWORD", ""),
            netbox_url=env.get("NETBOX_URL", "").rstrip("/"),
            netbox_token=env.get("NETBOX_TOKEN", ""),
            netbox_public_url=env.get("NETBOX_PUBLIC_URL", "").rstrip("/"),
            service_check_exclude=_csv(env.get("SERVICE_CHECK_EXCLUDE")),
        )
