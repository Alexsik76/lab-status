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
    const havm = makeGuest('havm', 'havm', 0) // 0 containers
    const portainer = makeGuest('portainer', 'portainer', 4, [6]) // 10 containers

    // Pass them in alphabetical order (havm, portainer)
    const cols = balanceMachineUnits([havm, portainer], [])

    expect(cols).toHaveLength(2)
    // Left column must contain portainer (10 containers)
    expect(cols[0].items.map((u) => u.guest?.name)).toEqual(['portainer'])
    // Right column must contain havm (0 containers)
    expect(cols[1].items.map((u) => u.guest?.name)).toEqual(['havm'])
  })

  it('places a heavy VM on the left and balances lighter LXCs on the right', () => {
    const netbox = makeGuest('netbox', 'netbox', 1, [6]) // 7 containers
    const jump = makeGuest('jump', 'jump', 0) // 0 containers
    const caddy = makeGuest('caddy', 'caddy', 0) // 0 containers
    const monitoring = makeGuest('monitoring', 'monitoring', 0) // 0 containers

    const cols = balanceMachineUnits([caddy, jump, monitoring, netbox], [])

    expect(cols).toHaveLength(2)
    // Left column has netbox
    expect(cols[0].items.map((u) => u.guest?.name)).toEqual(['netbox'])
    // Right column has the other 3
    expect(cols[1].items.map((u) => u.guest?.name)).toEqual(['caddy', 'jump', 'monitoring'])
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
})
