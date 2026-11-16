import { describe, expect, it } from 'vitest'
import type { Container, Guest } from '../domain/model'
import { countGuestContainers, orderMachineUnits } from './layout'

function makeContainer(id: string, name: string): Container {
  return {
    id,
    name,
    state: 'up',
    services: [],
    image: null,
    icon: null,
    stack: null,
    tags: [],
  }
}

function makeGuest(
  id: string,
  name: string,
  standaloneCount = 0,
  stackCounts: number[] = [],
): Guest {
  return {
    id,
    name,
    kind: 'KVM',
    state: 'up',
    vcpus: 2,
    memoryMb: 2048,
    disk: null,
    ip: null,
    platform: null,
    icon: null,
    cluster: null,
    tags: [],
    services: [],
    standalone: Array.from({ length: standaloneCount }, (_, i) =>
      makeContainer(`${id}-std-${i}`, `${name}-std-${i}`),
    ),
    stacks: stackCounts.map((count, sIdx) => ({
      name: `stack-${sIdx}`,
      state: 'up',
      containers: Array.from({ length: count }, (_, i) =>
        makeContainer(`${id}-s${sIdx}-${i}`, `${name}-s${sIdx}-${i}`),
      ),
    })),
  }
}

describe('layout: countGuestContainers', () => {
  it('counts both standalone and stack containers', () => {
    const g = makeGuest('g1', 'vm1', 3, [2, 4])
    expect(countGuestContainers(g)).toBe(9)
  })

  it('returns 0 for empty guest', () => {
    const g = makeGuest('g0', 'vm0', 0, [])
    expect(countGuestContainers(g)).toBe(0)
  })
})

describe('layout: orderMachineUnits', () => {
  it('returns nothing for an empty machine', () => {
    expect(orderMachineUnits([], [])).toEqual([])
  })

  it('puts the guest with more containers first', () => {
    const guestA = makeGuest('ga', 'guest-a', 0)
    const guestB = makeGuest('gb', 'guest-b', 4, [6])
    expect(orderMachineUnits([guestA, guestB], []).map((u) => u.guest?.name)).toEqual([
      'guest-b',
      'guest-a',
    ])
  })

  it('tie-breaks equal container counts alphabetically', () => {
    const vmB = makeGuest('b', 'beta', 2)
    const vmA = makeGuest('a', 'alpha', 2)
    expect(orderMachineUnits([vmB, vmA], []).map((u) => u.guest?.name)).toEqual(['alpha', 'beta'])
  })

  it('adds the apps attached straight to the machine as one group, ordered by size', () => {
    const vm = makeGuest('vm1', 'vm1', 3)
    const empty = makeGuest('vm2', 'vm2', 0)
    const apps = [makeContainer('app1', 'app1'), makeContainer('app2', 'app2')]
    const units = orderMachineUnits([vm, empty], apps)
    expect(units.map((u) => (u.isAppGroup ? 'apps' : u.guest?.name))).toEqual(['vm1', 'apps', 'vm2'])
    expect(units[1].apps).toHaveLength(2)
  })

  it('accounts for 1-container stacks sharing rows and adding a label line', () => {
    // 2 standalone containers: 1 row, 0 label lines -> est = 1 + 1.4 = 2.4
    const gStandalone = makeGuest('g-std', 'g-std', 2, [])
    const [u1] = orderMachineUnits([gStandalone], [])
    expect(u1.est).toBeCloseTo(2.4)

    // 2 one-container stacks: share 1 row, 1 label line -> est = 1 + 1.4 + 0.5 = 2.9
    const g2SingleStacks = makeGuest('g-2s', 'g-2s', 0, [1, 1])
    const [u2] = orderMachineUnits([g2SingleStacks], [])
    expect(u2.est).toBeCloseTo(2.9)

    // 1 one-container stack + 1 standalone: share 1 row, 1 label line -> est = 1 + 1.4 + 0.5 = 2.9
    const gMixedRow = makeGuest('g-mix', 'g-mix', 1, [1])
    const [u3] = orderMachineUnits([gMixedRow], [])
    expect(u3.est).toBeCloseTo(2.9)

    // 3 one-container stacks: 2 rows, both rows have label line -> est = 1 + 2.8 + 1.0 = 4.8
    const g3SingleStacks = makeGuest('g-3s', 'g-3s', 0, [1, 1, 1])
    const [u4] = orderMachineUnits([g3SingleStacks], [])
    expect(u4.est).toBeCloseTo(4.8)

    // 2 one-container stacks + 1 standalone: 2 rows, only first row has label line -> est = 1 + 2.8 + 0.5 = 4.3
    const g2Single1Std = makeGuest('g-2s1std', 'g-2s1std', 1, [1, 1])
    const [u5] = orderMachineUnits([g2Single1Std], [])
    expect(u5.est).toBeCloseTo(4.3)
  })
})
