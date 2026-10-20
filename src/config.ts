/** Same-origin NetBox GraphQL endpoint; the token is injected by nginx / the Vite dev proxy. */
export const NETBOX_GRAPHQL_URL = '/netbox/graphql/'

/** Same-origin service status endpoint; forwarded by nginx / Vite dev proxy to SERVICE_STATUS_URL. */
export const STATUS_URL = '/api/service-status'

/** Same-origin container status endpoint; forwarded by nginx / Vite dev proxy to CONTAINER_STATUS_URL. */
export const CONTAINER_STATUS_URL = '/api/container-status'

export const INVENTORY_TIMEOUT_MS = 20_000
export const STATUS_TIMEOUT_MS = 10_000
export const CONTAINER_STATUS_TIMEOUT_MS = 10_000

/** Same-origin Proxmox endpoints; the token is injected by nginx / the Vite dev proxy. */
export const PROXMOX_CLUSTER_RESOURCES_URL = '/proxmox/api2/json/cluster/resources'
export const PROXMOX_NODES_URL = '/proxmox/api2/json/nodes'
export const PROXMOX_TIMEOUT_MS = 10_000

/**
 * Shared reverse-proxied Proxmox Web UI. Server headers of Proxmox VE nodes link here,
 * with a per-node hash anchor so the right node is preselected in the resource tree.
 */
export const PROXMOX_WEB_URL = 'https://prox.lab.vn.ua'

/**
 * Primary (domain) URL for non-Proxmox servers, keyed by NetBox device name.
 * Servers missing here fall back to their raw service URL (ip:port).
 */
export const HOST_DOMAIN_URLS: Readonly<Record<string, string>> = {
  nas: 'https://truenas.lab.vn.ua',
}
