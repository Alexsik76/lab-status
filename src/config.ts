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
