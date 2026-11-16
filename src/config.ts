import type { IconName } from './presentation/platform'

/** Same-origin NetBox GraphQL endpoint; the token is injected by nginx / the Vite dev proxy. */
export const NETBOX_GRAPHQL_URL = '/netbox/graphql/'

/** Same-origin service status endpoint, answered by the backend. */
export const STATUS_URL = '/api/service-status'

/**
 * Same-origin Server-Sent Events stream of the backend; the SSE `event:` field names the
 * source (`arp`, ...). The app holds one connection to it.
 */
export const STREAM_URL = '/api/stream'

/** A tab hidden for longer than this closes the stream; it reopens when the tab is shown. */
export const STREAM_HIDDEN_CLOSE_MS = 10_000

/** Backoff for reopening the stream after the browser gave up on it (HTTP error answer). */
export const STREAM_RETRY_INITIAL_MS = 2_000
export const STREAM_RETRY_MAX_MS = 30_000

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
 * Icon per NetBox device name, when the platform does not say what the machine is
 * (e.g. a print server). Others take their platform's icon, else the generic server icon.
 */
export const HOST_ICONS: Readonly<Record<string, IconName>> = {
  prints: 'cups',
}

/**
 * Primary (domain) URL for non-Proxmox servers, keyed by NetBox device name.
 * Servers missing here fall back to their raw service URL (ip:port).
 */
export const HOST_DOMAIN_URLS: Readonly<Record<string, string>> = {
  nas: 'https://truenas.lab.vn.ua',
}
