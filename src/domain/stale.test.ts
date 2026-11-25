import { describe, expect, it } from 'vitest'
import { netboxResponse, statusEntries } from '../__fixtures__'
import { markUnknown } from './stale'
import { indexStatuses } from './statuses'
import { normalizeInventory } from './normalize'
import { buildTree } from './tree'
import type { LabTree, State } from './model'

function allStates(tree: LabTree): State[] {
  const containers = (list: LabTree['unplaced']) => list.flatMap((c) => [c.state, ...c.services.map((s) => s.state)])
  return [
    ...containers(tree.unplaced),
    ...tree.machines.flatMap((m) => [
      m.state,
      ...m.services.map((s) => s.state),
      ...containers(m.apps),
      ...m.guests.flatMap((g) => [
        g.state,
        ...g.services.map((s) => s.state),
        ...containers(g.standalone),
        ...g.stacks.flatMap((st) => [st.state, ...containers(st.containers)]),
      ]),
    ]),
  ]
}

describe('markUnknown', () => {
  const live = buildTree(
    normalizeInventory(netboxResponse.data!),
    indexStatuses(statusEntries),
  )

  it('turns every up / down into unknown and keeps stopped', () => {
    expect(allStates(live)).toContain('up')
    const stale = markUnknown(live)
    const states = new Set(allStates(stale))
    expect(states.has('up')).toBe(false)
    expect(states.has('down')).toBe(false)
    expect(allStates(stale).filter((s) => s === 'stopped')).toEqual(allStates(live).filter((s) => s === 'stopped'))
  })

  it('stops blinking and keeps the rest of the tree', () => {
    const i = live.machines.findIndex((m) => m.guests.length > 0)
    const host = live.machines[i]
    const guests = [{ ...host.guests[0], blinking: true }, ...host.guests.slice(1)]
    const machines = live.machines.map((m, j) => (j === i ? { ...host, guests } : m))
    const stale = markUnknown({ ...live, machines })
    expect(stale.machines[i].guests[0].blinking).toBe(false)
    expect(stale.machines.map((m) => m.name)).toEqual(live.machines.map((m) => m.name))
    expect(stale.machines.map((m) => m.metrics)).toEqual(live.machines.map((m) => m.metrics))
  })
})
