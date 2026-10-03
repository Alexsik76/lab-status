import type { Container, Guest, Machine, ServiceItem } from './model'

export interface HostHw {
  cores: number
  mem: number
}

export const HOSTHW: Record<string, HostHw> = {
  prox1: { cores: 8, mem: 16 },
  prox2: { cores: 4, mem: 16 },
  prox3: { cores: 4, mem: 16 },
  truenas: { cores: 8, mem: 16 },
  prints: { cores: 4, mem: 8 },
}

export const MACHINE_OS: Record<string, string> = {
  prox1: 'proxmox',
  prox2: 'proxmox',
  prox3: 'proxmox',
  truenas: 'truenas',
  prints: 'centos',
}

export const GUEST_OS: Record<string, string> = {
  havm: 'haos',
}

export function detectMachineOs(m: Machine): string {
  if (MACHINE_OS[m.name]) return MACHINE_OS[m.name]
  const lower = (m.name + ' ' + (m.platform || '') + ' ' + (m.model || '')).toLowerCase()
  if (lower.includes('prox') || lower.includes('pve')) return 'proxmox'
  if (lower.includes('truenas') || lower.includes('nas')) return 'truenas'
  if (lower.includes('centos') || lower.includes('rhel') || lower.includes('redhat')) return 'centos'
  if (lower.includes('debian') || lower.includes('ubuntu')) return 'debian'
  return 'proxmox'
}

export function detectGuestOs(g: Guest): string {
  if (GUEST_OS[g.name]) return GUEST_OS[g.name]
  const lower = (g.name + ' ' + (g.platform || '')).toLowerCase()
  if (lower.includes('haos') || lower.includes('homeassistant') || lower.includes('ha')) return 'haos'
  return 'debian'
}

export function getHostHardware(m: Machine): HostHw {
  if (HOSTHW[m.name]) return HOSTHW[m.name]
  const guestCores = m.guests.reduce((sum, g) => sum + (g.vcpus ?? 1), 0)
  const guestMem = Math.round(m.guests.reduce((sum, g) => sum + (g.memoryMb ?? 1024), 0) / 1024)
  const cores = Math.max(4, guestCores)
  const mem = Math.max(8, guestMem)
  return { cores, mem }
}

export function series(seed: number, base: number, n = 24): number[] {
  let s = seed
  let v = base
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280
    v = Math.min(0.98, Math.max(0.02, v + (s / 233280 - 0.5) * 0.16 + (base - v) * 0.25))
    out.push(v)
  }
  out[n - 1] = base
  return out
}

export function generateSparkPath(vals: number[], w: number, hgt: number): { line: string; area: string } {
  if (!vals || vals.length < 2) return { line: '', area: '' }
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, hgt - 1 - v * (hgt - 2)])
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = `${line} L${w} ${hgt} L0 ${hgt} Z`
  return { line, area }
}

export function resolveWebUrl(ip: string | null, port: number | null): string | null {
  if (!ip || !port) return null
  const isHttps = port === 443 || port === 8006 || port === 9443
  return `${isHttps ? 'https://' : 'http://'}${ip}${port === 443 ? '' : `:${port}`}`
}

export function getNodePrimaryUrlAndPort(
  services: ServiceItem[],
  fallbackIp: string | null = null,
): { url: string | null; portText: string } {
  const withUrl = services.find((s) => s.url)
  if (withUrl && withUrl.url) {
    const port = withUrl.ports.length > 0 ? withUrl.ports[0] : null
    return {
      url: withUrl.url,
      portText: port ? `:${port}` : '',
    }
  }

  const withPort = services.find((s) => s.ports.length > 0)
  if (withPort && withPort.ports.length > 0) {
    const port = withPort.ports[0]
    return {
      url: resolveWebUrl(fallbackIp, port),
      portText: `:${port}`,
    }
  }

  return { url: null, portText: '' }
}

export interface ColumnUnit {
  id: string
  isGuest: boolean
  isAppGroup: boolean
  guest?: Guest
  apps?: Container[]
  est: number
}

export function balanceMachineUnits(guests: Guest[], apps: Container[]): { items: ColumnUnit[] }[] {
  const units: ColumnUnit[] = []

  for (const g of guests) {
    const stackWeight = g.stacks.reduce(
      (sum, s) => sum + Math.ceil(s.containers.length / 2) * 1.4 + (s.containers.length > 1 ? 0.5 : 0),
      0,
    )
    const standaloneWeight = Math.ceil(g.standalone.length / 2) * 1.4
    const est = 1 + stackWeight + standaloneWeight
    units.push({
      id: g.id,
      isGuest: true,
      isAppGroup: false,
      guest: g,
      est: Math.max(1.2, est),
    })
  }

  if (apps.length > 0) {
    units.push({
      id: 'machine-apps',
      isGuest: false,
      isAppGroup: true,
      apps,
      est: Math.ceil(apps.length / 2) * 1.4,
    })
  }

  const cols: { items: ColumnUnit[]; h: number }[] = [
    { items: [], h: 0 },
    { items: [], h: 0 },
    { items: [], h: 0 },
  ]

  for (const u of units) {
    const c = cols.reduce((a, b) => (b.h < a.h ? b : a))
    c.items.push(u)
    c.h += u.est + 0.3
  }

  return cols.map((c) => ({ items: c.items }))
}
