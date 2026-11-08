import type { ArpEvent, ArpRow } from '../types/arp'

export type ArpRows = ReadonlyMap<string, ArpRow>

/** Presence of a NetBox object, keyed `device:<id>` / `vm:<id>`. */
export type ArpPresenceIndex = ReadonlyMap<string, 'up' | 'down'>

export type ArpView = 'all' | 'unknown' | 'active' | 'disconnected'

/** Applies one stream event to the mirrored rows; returns the same map when nothing changed. */
export function applyArpEvent(rows: ArpRows, event: ArpEvent): ArpRows {
  switch (event.type) {
    case 'snapshot':
      return new Map(event.rows.map((row) => [row.id, row]))
    case 'upsert': {
      const next = new Map(rows)
      next.set(event.row.id, event.row)
      return next
    }
    case 'remove': {
      if (!rows.has(event.id)) return rows
      const next = new Map(rows)
      next.delete(event.id)
      return next
    }
    default:
      return rows
  }
}

export const arpObjectKey = (kind: 'device' | 'vm', id: string) => `${kind}:${id}`

/**
 * Presence per NetBox object: up when any of its MACs is active,
 * down when it has entries and all of them are disconnected.
 */
export function indexArpPresence(rows: Iterable<ArpRow>): ArpPresenceIndex {
  const index = new Map<string, 'up' | 'down'>()
  for (const row of rows) {
    if (!row.netbox || row.presence === 'unknown') continue
    const key = arpObjectKey(row.netbox.kind, row.netbox.id)
    if (row.presence === 'active') index.set(key, 'up')
    else if (!index.has(key)) index.set(key, 'down')
  }
  return index
}

/** Same presence for every object: lets consumers skip recomputation on NUD noise. */
export function samePresence(a: ArpPresenceIndex, b: ArpPresenceIndex): boolean {
  if (a.size !== b.size) return false
  for (const [key, value] of a) if (b.get(key) !== value) return false
  return true
}

export function matchesView(row: ArpRow, view: ArpView): boolean {
  switch (view) {
    case 'unknown':
      return row.netbox === null
    case 'active':
      return row.presence === 'active'
    case 'disconnected':
      return row.presence === 'disconnected'
    default:
      return true
  }
}

export function countViews(rows: Iterable<ArpRow>): Record<ArpView, number> {
  const counts: Record<ArpView, number> = { all: 0, unknown: 0, active: 0, disconnected: 0 }
  for (const row of rows) {
    counts.all++
    if (row.netbox === null) counts.unknown++
    if (row.presence === 'active') counts.active++
    if (row.presence === 'disconnected') counts.disconnected++
  }
  return counts
}

/** Numeric IPv4 order (10.0.0.9 before 10.0.0.10); anything else sorts after, by text. */
export function compareAddresses(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const valid = (p: number[]) => p.length === 4 && p.every((n) => Number.isInteger(n))
  if (valid(pa) && valid(pb)) {
    for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
    return 0
  }
  if (valid(pa) !== valid(pb)) return valid(pa) ? -1 : 1
  return a.localeCompare(b)
}
