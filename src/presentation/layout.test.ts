import { describe, expect, it } from 'vitest'
import type { Container, Guest } from '../domain/model'
import { balanceMachineUnits, countGuestContainers } from './layout'

function makeContainer(id: string, name: string): Container {
  return {
    id,
    name,
    state: 'up',
    services: [],
    image: null,
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

describe('layout: balanceMachineUnits', () => {
  it('always produces exactly 2 columns', () => {
    const cols = balanceMachineUnits([], [])
    expect(cols).toHaveLength(2)
    expect(cols[0].items).toHaveLength(0)
    expect(cols[1].items).toHaveLength(0)
  })

  it('places the guest with more containers on the left (column 0)', () => {
    const guestA = makeGuest('ga', 'guest-a', 0) // 0 containers
    const guestB = makeGuest('gb', 'guest-b', 4, [6]) // 10 containers

    // Pass them in alphabetical order (guest-a, guest-b)
    const cols = balanceMachineUnits([guestA, guestB], [])

    expect(cols).toHaveLength(2)
    // Left column must contain guest-b (10 containers)
    expect(cols[0].items.map((u) => u.guest?.name)).toEqual(['guest-b'])
    // Right column must contain guest-a (0 containers)
    expect(cols[1].items.map((u) => u.guest?.name)).toEqual(['guest-a'])
  })

  it('places a heavy VM on the left and balances lighter LXCs on the right', () => {
    const heavyVm = makeGuest('heavy', 'heavy-vm', 1, [6]) // 7 containers
    const light1 = makeGuest('l1', 'light-1', 0) // 0 containers
    const light2 = makeGuest('l2', 'light-2', 0) // 0 containers
    const light3 = makeGuest('l3', 'light-3', 0) // 0 containers

    const cols = balanceMachineUnits([light1, light2, light3, heavyVm], [])

    expect(cols).toHaveLength(2)
    // Left column has heavyVm
    expect(cols[0].items.map((u) => u.guest?.name)).toEqual(['heavy-vm'])
    // Right column has the other 3
    expect(cols[1].items.map((u) => u.guest?.name)).toEqual(['light-1', 'light-2', 'light-3'])
  })

  it('tie-breaks equal container counts alphabetically', () => {
    const vmB = makeGuest('b', 'beta', 2)
    const vmA = makeGuest('a', 'alpha', 2)

    const cols = balanceMachineUnits([vmB, vmA], [])

    expect(cols).toHaveLength(2)
    // Alpha should be processed first into col 0, Beta into col 1
    expect(cols[0].items.map((u) => u.guest?.name)).toEqual(['alpha'])
    expect(cols[1].items.map((u) => u.guest?.name)).toEqual(['beta'])
  })

  it('handles host apps alongside guests', () => {
    const vm = makeGuest('vm1', 'vm1', 3)
    const apps = [makeContainer('app1', 'app1'), makeContainer('app2', 'app2')]

    const cols = balanceMachineUnits([vm], apps)

    expect(cols).toHaveLength(2)
    expect(cols[0].items.map((u) => u.guest?.name)).toEqual(['vm1'])
    expect(cols[1].items[0].isAppGroup).toBe(true)
  })

  it('accounts for 1-container stacks sharing rows and adding a label line', () => {
    // 2 standalone containers: 1 row, 0 label lines -> est = 1 + 1.4 = 2.4
    const gStandalone = makeGuest('g-std', 'g-std', 2, [])
    const [c1] = balanceMachineUnits([gStandalone], [])
    expect(c1.items[0].est).toBeCloseTo(2.4)

    // 2 one-container stacks: share 1 row, 1 label line -> est = 1 + 1.4 + 0.5 = 2.9
    const g2SingleStacks = makeGuest('g-2s', 'g-2s', 0, [1, 1])
    const [c2] = balanceMachineUnits([g2SingleStacks], [])
    expect(c2.items[0].est).toBeCloseTo(2.9)

    // 1 one-container stack + 1 standalone: share 1 row, 1 label line -> est = 1 + 1.4 + 0.5 = 2.9
    const gMixedRow = makeGuest('g-mix', 'g-mix', 1, [1])
    const [c3] = balanceMachineUnits([gMixedRow], [])
    expect(c3.items[0].est).toBeCloseTo(2.9)

    // 3 one-container stacks: 2 rows, both rows have label line -> est = 1 + 2.8 + 1.0 = 4.8
    const g3SingleStacks = makeGuest('g-3s', 'g-3s', 0, [1, 1, 1])
    const [c4] = balanceMachineUnits([g3SingleStacks], [])
    expect(c4.items[0].est).toBeCloseTo(4.8)

    // 2 one-container stacks + 1 standalone: 2 rows, only first row has label line -> est = 1 + 2.8 + 0.5 = 4.3
    const g2Single1Std = makeGuest('g-2s1std', 'g-2s1std', 1, [1, 1])
    const [c5] = balanceMachineUnits([g2Single1Std], [])
    expect(c5.items[0].est).toBeCloseTo(4.3)
  })
})

