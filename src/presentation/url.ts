import type { ServiceItem } from '../domain/model'

const WEB_SCHEMES = ['http', 'https']

const portTextOf = (service: ServiceItem): string => (service.ports.length > 0 ? `:${service.ports[0]}` : '')

/**
 * Resolves a web URL for a service: only http/https services are ever linked (other schemes
 * such as rtsp or webrtc, or no scheme, give null). Uses the status entry URL when present,
 * else the scheme and address from NetBox. Never guesses from port.
 */
export function resolveServiceUrl(service: ServiceItem, fallbackIp: string | null = null): string | null {
  if (!service.scheme || !WEB_SCHEMES.includes(service.scheme)) return null
  if (service.url) return service.url

  const ip = service.addresses.length > 0 ? service.addresses[0] : fallbackIp
  if (!ip) return null

  const port = service.ports.length > 0 ? service.ports[0] : null
  const isDefaultPort = (service.scheme === 'http' && port === 80) || (service.scheme === 'https' && port === 443)
  const portSuffix = port && !isDefaultPort ? `:${port}` : ''

  return `${service.scheme}://${ip}${portSuffix}`
}

export interface NodeLinks {
  /** Primary link: the public (reverse-proxy) URL when known, else the direct one. */
  url: string | null
  /** Direct `ip:port` URL that bypasses the reverse proxy. */
  directUrl: string | null
  portText: string
}

/**
 * The service that represents a node on its tile is the one flagged `check`. Without one, the
 * node is not clickable and only shows the port of the first service that has one.
 * The public URL is used only for a service that is linked at all (http/https).
 */
export function getNodePrimaryUrlAndPort(
  services: readonly ServiceItem[],
  fallbackIp: string | null = null,
): NodeLinks {
  const primary = services.find((s) => s.check)
  if (primary) {
    const directUrl = resolveServiceUrl(primary, fallbackIp)
    const url = directUrl ? (primary.publicUrl ?? directUrl) : null
    return { url, directUrl, portText: portTextOf(primary) }
  }

  const withPort = services.find((s) => s.ports.length > 0)
  return { url: null, directUrl: null, portText: withPort ? portTextOf(withPort) : '' }
}

/** Direct URL shown as a secondary link, only when the primary link goes elsewhere. */
export function secondaryDirectUrl(links: NodeLinks): string | null {
  return links.directUrl && links.directUrl !== links.url ? links.directUrl : null
}
