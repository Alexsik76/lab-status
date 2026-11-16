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
    #: Nginx Proxy Manager admin/API base URL and its login; public links are off unless all are set.
    npm_url: str = ""
    npm_identity: str = ""
    npm_secret: str = ""
    #: Proxmox VE API base URL (e.g. https://192.0.2.5:8006) and API token (`user@realm!id=secret`);
    #: the Proxmox sources are off unless both are set. TLS is not verified.
    proxmox_url: str = ""
    proxmox_token: str = ""
    proxmox_period_s: float = 15.0
    proxmox_metrics_period_s: float = 60.0
    #: Portainer base URL (direct, self-signed TLS: not verified) and API key (`X-API-Key`, a
    #: read-only user); the `containers` source is off unless both are set.
    portainer_url: str = ""
    portainer_token: str = ""
    #: Reconcile period of the `containers` source (full re-list of every environment).
    containers_period_s: float = 300.0
    #: Period of the full round of the `services` source (all checks).
    services_period_s: float = 180.0
    #: Period of the `inventory` source (NetBox inventory, check targets, MAC directory, NPM).
    inventory_period_s: float = 300.0
    #: Seconds the stream sources keep running after the last page disconnected.
    stream_grace_s: float = 10.0

    @property
    def proxmox_enabled(self) -> bool:
        return bool(self.proxmox_url and self.proxmox_token)

    @property
    def portainer_enabled(self) -> bool:
        return bool(self.portainer_url and self.portainer_token)

    @property
    def npm_enabled(self) -> bool:
        return bool(self.npm_url and self.npm_identity and self.npm_secret)

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
            npm_url=env.get("NPM_URL", "").rstrip("/"),
            npm_identity=env.get("NPM_IDENTITY", ""),
            npm_secret=env.get("NPM_SECRET", ""),
            proxmox_url=env.get("PROXMOX_URL", "").rstrip("/"),
            proxmox_token=env.get("PROXMOX_TOKEN", ""),
            proxmox_period_s=float(env.get("PROXMOX_PERIOD_S") or 15.0),
            proxmox_metrics_period_s=float(env.get("PROXMOX_METRICS_PERIOD_S") or 60.0),
            portainer_url=env.get("PORTAINER_URL", "").rstrip("/"),
            portainer_token=env.get("PORTAINER_TOKEN", ""),
            containers_period_s=float(env.get("CONTAINERS_PERIOD_S") or 300.0),
            services_period_s=float(env.get("SERVICES_PERIOD_S") or 180.0),
            inventory_period_s=float(env.get("INVENTORY_PERIOD_S") or 300.0),
            stream_grace_s=float(env.get("STREAM_GRACE_S") or 10.0),
        )
