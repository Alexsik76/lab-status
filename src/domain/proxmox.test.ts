import { describe, expect, it } from 'vitest'
import {
  applyProxmoxNodeStatus,
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
        makeVm({ id: 'vm-bastion', name: 'lxc-bastion', kind: 'LXC' }),
        makeVm({ id: 'vm-worker', name: 'vm-worker', kind: 'KVM' }),
      ],
      services: [],
    }

    const resources: ProxmoxGuestResource[] = [
      {
        type: 'lxc',
        vmid: 104,
        name: 'lxc-bastion',
        node: 'node-beta',
        status: 'running',
        cpu: 0.01,
        mem: 50000000,
        maxmem: 536870912,
      },
      {
        type: 'qemu',
        vmid: 109,
        name: 'vm-worker',
        node: 'node-gamma',
        status: 'running',
        cpu: 0.02,
        mem: 1500000000,
        maxmem: 2147483648,
      },
      {
        type: 'qemu',
        vmid: 999,
        name: 'unmatched-guest',
        node: 'node-alpha',
        status: 'running',
        cpu: 0,
        mem: 0,
        maxmem: 100,
      },
    ]

    const matched = matchProxmoxGuests(resources, inventory)
    expect(matched.size).toBe(2)
    expect(matched.get('vm-bastion')).toEqual(resources[0])
    expect(matched.get('vm-worker')).toEqual(resources[1])
    expect(matched.has('999')).toBe(false)
  })

  it('matches real fixture guests', () => {
    const inventory = normalizeInventory(rawInventory)
    const matched = matchProxmoxGuests(proxmoxResources, inventory)

    const findByName = (name: string) => inventory.vms.find((v) => v.name === name)

    const bastion = findByName('lxc-bastion')
    const worker = findByName('vm-worker')
    const gateway = findByName('lxc-gateway-st')
    const home = findByName('vm-home')

    expect(matched.get(bastion!.id)?.status).toBe('running')
    expect(matched.get(worker!.id)?.status).toBe('running')
    expect(matched.get(gateway!.id)?.status).toBe('stopped')
    expect(matched.get(home!.id)?.status).toBe('running')
  })
})

describe('resolveGuestState', () => {
  it('prefers live data over offline: offline + live running -> up; offline + no live data -> stopped', () => {
    const vm = makeVm({ offline: true, name: 'lxc-bastion' })
    const runningGuest: ProxmoxGuestResource = {
      type: 'lxc',
      vmid: 104,
      name: 'lxc-bastion',
      node: 'node-beta',
      status: 'running',
      cpu: 0.01,
      mem: 1000,
      maxmem: 2000,
    }

    // 1. offline + live running -> up
    expect(resolveGuestState(vm, [], runningGuest)).toEqual({
      state: 'up',
      blinking: false,
    })
    expect(resolveGuestState(vm, ['up'], runningGuest)).toEqual({
      state: 'up',
      blinking: false,
    })

    // 2. offline + no live data -> stopped
    expect(resolveGuestState(vm, [], null)).toEqual({
      state: 'stopped',
      blinking: false,
    })
  })

  it('Proxmox says stopped -> stopped (grey)', () => {
    const vm = makeVm({ offline: false, name: 'lxc-gateway-st', kind: 'LXC' })
    const guest: ProxmoxGuestResource = {
      type: 'lxc',
      vmid: 105,
      name: 'lxc-gateway-st',
      node: 'node-beta',
      status: 'stopped',
      cpu: 0,
      mem: 0,
      maxmem: 2000,
    }

    const result = resolveGuestState(vm, ['up'], guest)
    expect(result).toEqual({ state: 'stopped', blinking: false })
  })

  it('Proxmox running and HTTP check fails -> down: red and blinking', () => {
    const vm = makeVm({ offline: false, name: 'vm-home', kind: 'KVM' })
    const guest: ProxmoxGuestResource = {
      type: 'qemu',
      vmid: 100,
      name: 'vm-home',
      node: 'node-alpha',
      status: 'running',
      cpu: 0.05,
      mem: 1000,
      maxmem: 2000,
    }

    const result = resolveGuestState(vm, ['down'], guest)
    expect(result).toEqual({ state: 'down', blinking: true })
  })

  it('Proxmox running and HTTP check passes -> up', () => {
    const vm = makeVm({ offline: false, name: 'vm-home', kind: 'KVM' })
    const guest: ProxmoxGuestResource = {
      type: 'qemu',
      vmid: 100,
      name: 'vm-home',
      node: 'node-alpha',
      status: 'running',
      cpu: 0.05,
      mem: 1000,
      maxmem: 2000,
    }

    const result = resolveGuestState(vm, ['up'], guest)
    expect(result).toEqual({ state: 'up', blinking: false })
  })

  it('Proxmox running and HTTP check does not exist -> up', () => {
    const vm = makeVm({ offline: false, name: 'lxc-bastion', kind: 'LXC' })
    const guest: ProxmoxGuestResource = {
      type: 'lxc',
      vmid: 104,
      name: 'lxc-bastion',
      node: 'node-beta',
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
        node: 'node-alpha',
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

    const metricsMap = mapMachineMetrics(resources, { 'node-alpha': rrdPoints })
    expect(metricsMap.size).toBe(1)

    const alpha = metricsMap.get('node-alpha')
    expect(alpha).toBeDefined()
    expect(alpha?.cpu.currentPct).toBe('18%')
    expect(alpha?.cpu.spark).not.toBeNull()
    expect(alpha?.mem.currentPct).toBe('69%')
    expect(alpha?.mem.spark).not.toBeNull()

    expect(metricsMap.get('storage-nas')).toBeUndefined()
  })
})

describe('buildTree with Proxmox integration', () => {
  it('correctly sets guest states and node metrics from real fixtures', () => {
    const inventory = normalizeInventory(rawInventory)
    const statusMap = indexStatuses(statusEntries)
    const dockerIndex = matchDockerContainers(containerStatusEntries, inventory)
    const proxmoxGuests = matchProxmoxGuests(proxmoxResources, inventory)
    const machineMetrics = mapMachineMetrics(proxmoxResources, {
      'node-alpha': proxmoxRrdPoints,
      'node-beta': proxmoxRrdPoints,
      'node-gamma': proxmoxRrdPoints,
    })

    const tree = buildTree(inventory, statusMap, dockerIndex, proxmoxGuests, machineMetrics)

    // Check guests
    const allGuests = tree.machines.flatMap((m) => m.guests)
    const findGuest = (name: string) => allGuests.find((g) => g.name === name)

    const bastion = findGuest('lxc-bastion')
    expect(bastion?.state).toBe('up')

    const worker = findGuest('vm-worker')
    expect(worker?.state).toBe('up')

    const gateway = findGuest('lxc-gateway-st')
    expect(gateway?.state).toBe('stopped')

    // Check machine metrics
    const findMachine = (name: string) => tree.machines.find((m) => m.name === name)

    const alpha = findMachine('node-alpha')
    expect(alpha?.metrics).toBeDefined()
    expect(alpha?.metrics?.cpu.currentPct).toMatch(/^\d+%$/)
    expect(alpha?.metrics?.cpu.spark).not.toBeNull()
    expect(alpha?.metrics?.mem.spark).not.toBeNull()

    const beta = findMachine('node-beta')
    expect(beta?.metrics).toBeDefined()

    const gamma = findMachine('node-gamma')
    expect(gamma?.metrics).toBeDefined()

    const storage = findMachine('storage-nas')
    expect(storage?.metrics).toBeNull()

    const print = findMachine('host-print')
    expect(print?.metrics).toBeNull()
  })
})

describe('applyProxmoxNodeStatus', () => {
  it('takes the state from the node status, offline NetBox machines stay stopped', () => {
    expect(applyProxmoxNodeStatus('unknown', 'online', false)).toBe('up')
    expect(applyProxmoxNodeStatus('up', 'offline', false)).toBe('down')
    expect(applyProxmoxNodeStatus('up', 'offline', true)).toBe('stopped')
  })

  it('keeps the state when the node status is missing or unknown', () => {
    expect(applyProxmoxNodeStatus('down', undefined, false)).toBe('down')
    expect(applyProxmoxNodeStatus('up', 'unknown', false)).toBe('up')
  })
})

describe('buildTree: machine state from the Proxmox node status', () => {
  const inventory = normalizeInventory(rawInventory)
  const statusMap = indexStatuses(statusEntries)
  const alpha = inventory.devices.find((d) => d.name === 'node-alpha')!
  const storage = inventory.devices.find((d) => d.name === 'storage-nas')!
  // A NetBox machine matching the offline Proxmox node of the fixture.
  const delta = { ...alpha, id: '990', name: 'node-delta' }
  const withDelta = (offline: boolean) => ({
    ...inventory,
    devices: [...inventory.devices, { ...delta, offline }],
  })
  const metrics = mapMachineMetrics(proxmoxResources, {})
  const arp = (...entries: [string, 'up' | 'down'][]) =>
    new Map(entries.map(([id, presence]) => [`device:${id}`, presence]))
  const machine = (tree: ReturnType<typeof buildTree>, name: string) =>
    tree.machines.find((m) => m.name === name)!

  it('fixture contains an offline node', () => {
    expect(metrics.get('node-delta')?.nodeStatus).toBe('offline')
    expect(metrics.get('node-alpha')?.nodeStatus).toBe('online')
  })

  it('online node without an ARP entry is up', () => {
    const failing = indexStatuses(statusEntries.map((e) => ({ ...e, up: false })))
    const tree = buildTree(inventory, failing, new Map(), new Map(), metrics, new Map())
    expect(machine(tree, 'node-alpha').state).toBe('up')
  })

  it('online node wins over ARP presence down', () => {
    const tree = buildTree(inventory, statusMap, new Map(), new Map(), metrics, arp([alpha.id, 'down']))
    expect(machine(tree, 'node-alpha').state).toBe('up')
  })

  it('offline node is down while its ARP presence (iLO) is up', () => {
    const tree = buildTree(withDelta(false), statusMap, new Map(), new Map(), metrics, arp([delta.id, 'up']))
    expect(machine(tree, 'node-delta').state).toBe('down')
  })

  it('offline node is stopped when the machine is offline in NetBox', () => {
    const tree = buildTree(withDelta(true), statusMap, new Map(), new Map(), metrics, arp([delta.id, 'up']))
    expect(machine(tree, 'node-delta').state).toBe('stopped')
  })

  it('without Proxmox data ARP presence decides', () => {
    const up = buildTree(withDelta(false), statusMap, new Map(), new Map(), new Map(), arp([delta.id, 'up']))
    expect(machine(up, 'node-delta').state).toBe('up')
    const down = buildTree(inventory, statusMap, new Map(), new Map(), new Map(), arp([alpha.id, 'down']))
    expect(machine(down, 'node-alpha').state).toBe('down')
  })

  it('without a node entry for the machine ARP presence decides', () => {
    const partial = mapMachineMetrics(
      proxmoxResources.filter((r) => !(r.type === 'node' && r.node === 'node-alpha')),
      {},
    )
    const tree = buildTree(inventory, statusMap, new Map(), new Map(), partial, arp([alpha.id, 'down']))
    expect(machine(tree, 'node-alpha').state).toBe('down')
  })

  it('leaves machines that are not Proxmox nodes unaffected', () => {
    const presence = arp([storage.id, 'down'])
    const withProxmox = buildTree(inventory, statusMap, new Map(), new Map(), metrics, presence)
    const without = buildTree(inventory, statusMap, new Map(), new Map(), new Map(), presence)
    expect(machine(withProxmox, 'storage-nas').state).toBe('down')
    expect(machine(withProxmox, 'storage-nas').state).toBe(machine(without, 'storage-nas').state)
  })
})
