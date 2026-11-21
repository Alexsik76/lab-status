/** The page and the device to focus, read from and written to the location hash. */

export type Page = 'hosts' | 'topology' | 'arp'

export interface Route {
  page: Page
  /** NetBox device id to scroll to and highlight once (`?focus=<id>`), or null. */
  focus: string | null
}

const PATHS: Record<Page, string> = { hosts: '/', topology: '/topology', arp: '/arp' }

/** `#/`, `#/topology`, `#/arp`, each optionally with `?focus=<deviceId>` (not on ARP). */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const q = raw.indexOf('?')
  const path = (q === -1 ? raw : raw.slice(0, q)).replace(/\/+$/, '') || '/'
  const page = (Object.keys(PATHS) as Page[]).find((p) => PATHS[p] === path) ?? 'hosts'
  const focus = q === -1 ? null : new URLSearchParams(raw.slice(q + 1)).get('focus')
  const valid = focus !== null && /^[\w-]{1,64}$/.test(focus)
  return { page, focus: page !== 'arp' && valid ? focus : null }
}

export function routeHash(page: Page, focus: string | null = null): string {
  const base = `#${PATHS[page]}`
  return focus ? `${base}?focus=${encodeURIComponent(focus)}` : base
}
