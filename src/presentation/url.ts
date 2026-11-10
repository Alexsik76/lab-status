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

/**
 * The service that represents a node on its tile is the one flagged `check`. Without one, the
 * node is not clickable and only shows the port of the first service that has one.
 */
export function getNodePrimaryUrlAndPort(
  services: readonly ServiceItem[],
  fallbackIp: string | null = null,
): { url: string | null; portText: string } {
  const primary = services.find((s) => s.check)
  if (primary) return { url: resolveServiceUrl(primary, fallbackIp), portText: portTextOf(primary) }

  const withPort = services.find((s) => s.ports.length > 0)
  return { url: null, portText: withPort ? portTextOf(withPort) : '' }
}
