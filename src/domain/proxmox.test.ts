import { describe, expect, it } from 'vitest'
import {
  buildSparkline,
  mapMachineMetrics,
  matchProxmoxGuests,
  resolveGuestState,
} from './proxmox'
import type { Inventory, VmRecord } from './model'
import type {
  ProxmoxGuestResource,
  ProxmoxNodeResource,
  ProxmoxRrdPoint,
} from '../types/proxmox'
import {
  containerStatusEntries,
  proxmoxResources,
  proxmoxRrdPoints,
  rawInventory,
  statusEntries,
} from '../__fixtures__'
import { matchDockerContainers } from './containerStatuses'
import { normalizeInventory } from './normalize'
import { indexStatuses } from './statuses'
import { buildTree } from './tree'

function makeVm(partial: Partial<VmRecord>): VmRecord {
  return {
    id: 'vm-1',
    name: 'test-vm',
    alias: null,
    kind: 'KVM',
    offline: false,
    vcpus: 2,
    memoryMb: 2048,
    disk: null,
    description: '',
    image: null,
    stack: null,
    cluster: null,
    platform: null,
    ip: null,
    tags: [],
    deviceId: null,
    hostId: null,
    ...partial,
  }
}

describe('buildSparkline', () => {
  it('returns null for fewer than 2 points', () => {
    expect(buildSparkline([])).toBeNull()
    expect(buildSparkline([0.5])).toBeNull()
  })

  it('generates line and area SVG paths for normalized values', () => {
    const vals = [0.1, 0.5, 0.9]
    const result = buildSparkline(vals, 50, 14)
    expect(result).not.toBeNull()
    expect(result?.line).toMatch(/^M0\.0 \d+\.\d+ L25\.0 \d+\.\d+ L50\.0 \d+\.\d+$/)
    expect(result?.area).toContain('L50 14 L0 14 Z')
  })

  it('clamps out-of-range or NaN values gracefully', () => {
    const vals = [-0.5, NaN, 1.5]
    const result = buildSparkline(vals, 50, 14)
    expect(result).not.toBeNull()
    expect(result?.line).toBeDefined()
  })
})

describe('matchProxmoxGuests', () => {
  it('matches Proxmox guests to NetBox VMs/LXCs by name', () => {
    const inventory: Inventory = {
      devices: [],
      vms: [
        makeVm({ id: 'vm-jump', name: 'jump', kind: 'LXC' }),
        makeVm({ id: 'vm-agent', name: 'agent', kind: 'KVM' }),
      ],
      services: [],
    }

    const resources: ProxmoxGuestResource[] = [
      {
        type: 'lxc',
        vmid: 104,
        name: 'jump',
        node: 'prox2',
        status: 'running',
        cpu: 0.01,
        mem: 50000000,
        maxmem: 536870912,
      },
      {
        type: 'qemu',
        vmid: 109,
        name: 'agent',
        node: 'prox3',
        status: 'running',
        cpu: 0.02,
        mem: 1500000000,
        maxmem: 2147483648,
      },
      {
        type: 'qemu',
        vmid: 999,
        name: 'unmatched-guest',
        node: 'prox1',
        status: 'running',
        cpu: 0,
        mem: 0,
        maxmem: 100,
      },
    ]

    const matched = matchProxmoxGuests(resources, inventory)
    expect(matched.size).toBe(2)
    expect(matched.get('vm-jump')).toEqual(resources[0])
    expect(matched.get('vm-agent')).toEqual(resources[1])
    expect(matched.has('999')).toBe(false)
  })

  it('matches real fixture guests', () => {
    const inventory = normalizeInventory(rawInventory)
    const matched = matchProxmoxGuests(proxmoxResources, inventory)

    const findByName = (name: string) => inventory.vms.find((v) => v.name === name)

    const jump = findByName('jump')
    const agent = findByName('agent')
    const caddy = findByName('caddy-st')
    const havm = findByName('havm')

    expect(matched.get(jump!.id)?.status).toBe('running')
    expect(matched.get(agent!.id)?.status).toBe('running')
    expect(matched.get(caddy!.id)?.status).toBe('stopped')
    expect(matched.get(havm!.id)?.status).toBe('running')
  })
})

describe('resolveGuestState', () => {
  it('offline in NetBox still means stopped regardless of Proxmox state', () => {
    const vm = makeVm({ offline: true, name: 'jump' })
    const guest: ProxmoxGuestResource = {
      type: 'lxc',
      vmid: 104,
      name: 'jump',
      node: 'prox2',
      status: 'running',
      cpu: 0.01,
      mem: 1000,
      maxmem: 2000,
    }

    const result = resolveGuestState(vm, ['up'], guest)
    expect(result).toEqual({ state: 'stopped', blinking: false })
  })

  it('Proxmox says stopped -> stopped (grey)', () => {
    const vm = makeVm({ offline: false, name: 'caddy-st', kind: 'LXC' })
    const guest: ProxmoxGuestResource = {
      type: 'lxc',
      vmid: 105,
      name: 'caddy-st',
      node: 'prox2',
      status: 'stopped',
      cpu: 0,
      mem: 0,
      maxmem: 2000,
    }

    const result = resolveGuestState(vm, ['up'], guest)
    expect(result).toEqual({ state: 'stopped', blinking: false })
  })

  it('Proxmox running and HTTP check fails -> down: red and blinking', () => {
    const vm = makeVm({ offline: false, name: 'havm', kind: 'KVM' })
    const guest: ProxmoxGuestResource = {
      type: 'qemu',
      vmid: 100,
      name: 'havm',
      node: 'prox1',
      status: 'running',
      cpu: 0.05,
      mem: 1000,
      maxmem: 2000,
    }

    const result = resolveGuestState(vm, ['down'], guest)
    expect(result).toEqual({ state: 'down', blinking: true })
  })

  it('Proxmox running and HTTP check passes -> up', () => {
    const vm = makeVm({ offline: false, name: 'havm', kind: 'KVM' })
    const guest: ProxmoxGuestResource = {
      type: 'qemu',
      vmid: 100,
      name: 'havm',
      node: 'prox1',
      status: 'running',
      cpu: 0.05,
      mem: 1000,
      maxmem: 2000,
    }

    const result = resolveGuestState(vm, ['up'], guest)
    expect(result).toEqual({ state: 'up', blinking: false })
  })

  it('Proxmox running and HTTP check does not exist -> up', () => {
    const vm = makeVm({ offline: false, name: 'jump', kind: 'LXC' })
    const guest: ProxmoxGuestResource = {
      type: 'lxc',
      vmid: 104,
      name: 'jump',
      node: 'prox2',
      status: 'running',
      cpu: 0.01,
      mem: 1000,
      maxmem: 2000,
    }

    const result = resolveGuestState(vm, [], guest)
    expect(result).toEqual({ state: 'up', blinking: false })
  })

  it('NetBox records with no Proxmox entry keep current rules', () => {
    const vm = makeVm({ offline: false, name: 'unmanaged' })
    expect(resolveGuestState(vm, [])).toEqual({ state: 'unknown', blinking: false })
    expect(resolveGuestState(vm, ['up'])).toEqual({ state: 'up', blinking: false })
    expect(resolveGuestState(vm, ['down'])).toEqual({ state: 'down', blinking: false })
  })
})

describe('mapMachineMetrics', () => {
  it('maps metrics and sparklines only for nodes present in Proxmox', () => {
    const resources: ProxmoxNodeResource[] = [
      {
        type: 'node',
        node: 'prox1',
        status: 'online',
        cpu: 0.18,
        maxcpu: 8,
        mem: 10735270570,
        maxmem: 15642816512,
      },
    ]

    const rrdPoints: ProxmoxRrdPoint[] = [
      { time: 100, cpu: 0.1, memused: 5000, memtotal: 10000 },
      { time: 200, cpu: 0.2, memused: 6000, memtotal: 10000 },
    ]

    const metricsMap = mapMachineMetrics(resources, { prox1: rrdPoints })
    expect(metricsMap.size).toBe(1)

    const prox1 = metricsMap.get('prox1')
    expect(prox1).toBeDefined()
    expect(prox1?.cpu.currentPct).toBe('18%')
    expect(prox1?.cpu.spark).not.toBeNull()
    expect(prox1?.mem.currentPct).toBe('69%')
    expect(prox1?.mem.spark).not.toBeNull()

    expect(metricsMap.get('truenas')).toBeUndefined()
  })
})

describe('buildTree with Proxmox integration', () => {
  it('correctly sets guest states and node metrics from real fixtures', () => {
    const inventory = normalizeInventory(rawInventory)
    const statusMap = indexStatuses(statusEntries)
    const dockerIndex = matchDockerContainers(containerStatusEntries, inventory)
    const proxmoxGuests = matchProxmoxGuests(proxmoxResources, inventory)
    const machineMetrics = mapMachineMetrics(proxmoxResources, {
      prox1: proxmoxRrdPoints,
      prox2: proxmoxRrdPoints,
      prox3: proxmoxRrdPoints,
    })

    const tree = buildTree(inventory, statusMap, dockerIndex, proxmoxGuests, machineMetrics)

    // Check guests
    const allGuests = tree.machines.flatMap((m) => m.guests)
    const findGuest = (name: string) => allGuests.find((g) => g.name === name)

    const jump = findGuest('jump')
    expect(jump?.state).toBe('up')

    const agent = findGuest('agent')
    expect(agent?.state).toBe('up')

    const caddy = findGuest('caddy-st')
    expect(caddy?.state).toBe('stopped')

    // Check machine metrics
    const findMachine = (name: string) => tree.machines.find((m) => m.name === name)

    const prox1 = findMachine('prox1')
    expect(prox1?.metrics).toBeDefined()
    expect(prox1?.metrics?.cpu.currentPct).toMatch(/^\d+%$/)
    expect(prox1?.metrics?.cpu.spark).not.toBeNull()
    expect(prox1?.metrics?.mem.spark).not.toBeNull()

    const prox2 = findMachine('prox2')
    expect(prox2?.metrics).toBeDefined()

    const prox3 = findMachine('prox3')
    expect(prox3?.metrics).toBeDefined()

    const truenas = findMachine('truenas')
    expect(truenas?.metrics).toBeNull()

    const prints = findMachine('prints')
    expect(prints?.metrics).toBeNull()
  })
})
