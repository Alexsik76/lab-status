import type { Container, Guest } from '../domain/model'

export interface ColumnUnit {
  id: string
  isGuest: boolean
  isAppGroup: boolean
  guest?: Guest
  apps?: Container[]
  est: number
}

export function countGuestContainers(g: Guest): number {
  return g.standalone.length + g.stacks.reduce((sum, s) => sum + s.containers.length, 0)
}

/**
 * Balances guests and apps across 2 columns to optimize vertical alignment.
 * Guests with more containers are sorted first so they appear on the left.
 */
export function balanceMachineUnits(guests: Guest[], apps: Container[]): { items: ColumnUnit[] }[] {
  const sortedGuests = [...guests].sort((a, b) => {
    const diff = countGuestContainers(b) - countGuestContainers(a)
    if (diff !== 0) return diff
    return a.name.localeCompare(b.name)
  })

  const units: ColumnUnit[] = []

  for (const g of sortedGuests) {
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
  ]

  for (const u of units) {
    const c = cols.reduce((a, b) => (b.h < a.h ? b : a))
    c.items.push(u)
    c.h += u.est + 0.3
  }

  return cols.map((c) => ({ items: c.items }))
}
