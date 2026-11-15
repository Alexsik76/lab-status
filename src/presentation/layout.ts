import type { Container, Guest } from '../domain/model'

export interface MachineUnit {
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
 * Units of a machine (guests, then the group of apps attached straight to it), biggest first.
 * `est` is the estimated height; CSS wraps the units by their content.
 */
export function orderMachineUnits(guests: Guest[], apps: Container[]): MachineUnit[] {
  const sortedGuests = [...guests].sort((a, b) => {
    const diff = countGuestContainers(b) - countGuestContainers(a)
    if (diff !== 0) return diff
    return a.name.localeCompare(b.name)
  })

  const units: MachineUnit[] = []

  for (const g of sortedGuests) {
    const multiStacks = g.stacks.filter((s) => s.containers.length > 1)
    const singleStacks = g.stacks.filter((s) => s.containers.length === 1)

    const multiStackWeight = multiStacks.reduce(
      (sum, s) => sum + Math.ceil(s.containers.length / 2) * 1.4 + 0.5,
      0,
    )
    const singleCells = singleStacks.length + g.standalone.length
    const singleWeight =
      Math.ceil(singleCells / 2) * 1.4 + Math.ceil(singleStacks.length / 2) * 0.5

    const est = 1 + multiStackWeight + singleWeight
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

  // Stable sort: equal estimates keep the guests' order (container count, then name).
  return units.sort((a, b) => b.est - a.est)
}
