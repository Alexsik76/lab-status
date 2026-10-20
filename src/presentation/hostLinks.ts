import { HOST_DOMAIN_URLS, PROXMOX_WEB_URL } from '../config'

const PROXMOX_PLATFORM = 'Proxmox VE'

export interface HostDomainLinkOptions {
  proxmoxWebUrl?: string
  domainUrls?: Readonly<Record<string, string>>
}

/**
 * Primary (domain, reverse-proxied) URL for a server header.
 * - Proxmox VE nodes: the shared Proxmox Web UI with the node preselected via hash anchor.
 * - Other servers: an explicit entry from the domain map.
 * Returns null when no domain is known; the caller decides on a fallback.
 */
export function resolveHostDomainUrl(
  machine: { name: string; platform: string | null },
  options: HostDomainLinkOptions = {},
): string | null {
  const proxmoxWebUrl = options.proxmoxWebUrl ?? PROXMOX_WEB_URL
  const domainUrls = options.domainUrls ?? HOST_DOMAIN_URLS

  const explicit = domainUrls[machine.name]
  if (explicit) return explicit

  if (machine.platform?.trim() === PROXMOX_PLATFORM && proxmoxWebUrl) {
    return `${proxmoxWebUrl.replace(/\/+$/, '')}/#v1:0:=node/${encodeURIComponent(machine.name)}`
  }

  return null
}

/** Host part of a URL for tooltips (`https://prox.lab.vn.ua/#…` → `prox.lab.vn.ua`). */
export function urlHostLabel(url: string | null): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
