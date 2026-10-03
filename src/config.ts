/** Same-origin NetBox GraphQL endpoint; the token is injected by nginx / the Vite dev proxy. */
export const NETBOX_GRAPHQL_URL = '/netbox/graphql/'

/**
 * n8n webhook that returns the live service checks. The browser calls it directly
 * (CORS is enabled on the n8n side). Not a secret, so a build-time override is fine.
 */
export const STATUS_URL: string =
  import.meta.env.VITE_STATUS_URL || 'https://n8n.lab.vn.ua/webhook/service-status'

/**
 * n8n webhook that returns the live Docker container states from Portainer.
 */
export const CONTAINER_STATUS_URL: string =
  import.meta.env.VITE_CONTAINER_STATUS_URL || 'https://n8n.lab.vn.ua/webhook/container-status'

export const INVENTORY_TIMEOUT_MS = 20_000
export const STATUS_TIMEOUT_MS = 10_000
export const CONTAINER_STATUS_TIMEOUT_MS = 10_000
