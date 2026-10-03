import type { ServiceItem } from '../domain/model'

/**
 * Resolves a web URL for a service using only explicitly provided scheme
 * (from custom_fields.scheme) or a status entry URL. Never guesses from port.
 */
export function resolveServiceUrl(service: ServiceItem, fallbackIp: string | null = null): string | null {
  if (service.url) return service.url
  if (!service.scheme) return null

  const ip = service.addresses.length > 0 ? service.addresses[0] : fallbackIp
  if (!ip) return null

  const port = service.ports.length > 0 ? service.ports[0] : null
  const scheme = service.scheme.toLowerCase()

  const isDefaultPort = (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443)
  const portSuffix = port && !isDefaultPort ? `:${port}` : ''

  return `${scheme}://${ip}${portSuffix}`
}

export function getNodePrimaryUrlAndPort(
  services: readonly ServiceItem[],
  fallbackIp: string | null = null,
): { url: string | null; portText: string } {
  // 1. Prefer service with existing status URL
  const withUrl = services.find((s) => s.url)
  if (withUrl && withUrl.url) {
    const port = withUrl.ports.length > 0 ? withUrl.ports[0] : null
    return {
      url: withUrl.url,
      portText: port ? `:${port}` : '',
    }
  }

  // 2. Prefer service with an explicit custom_fields.scheme
  const withScheme = services.find((s) => s.scheme)
  if (withScheme) {
    const url = resolveServiceUrl(withScheme, fallbackIp)
    const port = withScheme.ports.length > 0 ? withScheme.ports[0] : null
    return {
      url,
      portText: port ? `:${port}` : '',
    }
  }

  // 3. Fallback: display port number if any service has ports, but url remains null (non-clickable)
  const withPort = services.find((s) => s.ports.length > 0)
  if (withPort && withPort.ports.length > 0) {
    return {
      url: null,
      portText: `:${withPort.ports[0]}`,
    }
  }

  return { url: null, portText: '' }
}
