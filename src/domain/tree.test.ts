import { describe, expect, it } from 'vitest'
import { rawInventory, statusEntries } from '../__fixtures__'
import type { Guest, Inventory, VmRecord } from './model'
import { normalizeInventory } from './normalize'
import { indexStatuses } from './statuses'
import { buildTree, countTree } from './tree'
import type { StatusEntry } from '../types/status'

const inventory = normalizeInventory(rawInventory)
const statuses = indexStatuses(statusEntries)

const guestByName = (name: string, tree = buildTree(inventory, statuses)): Guest => {
  const guest = tree.machines.flatMap((m) => m.guests).find((g) => g.name === name)
  if (!guest) throw new Error(`guest ${name} not found`)
  return guest
}

const withStatus = (overrides: (e: StatusEntry) => Partial<StatusEntry>) =>
  indexStatuses(statusEntries.map((e) => ({ ...e, ...overrides(e) })))

describe('buildTree (real data)', () => {
  const tree = buildTree(inventory, statuses)

  it('matches the counts in NetBox', () => {
    expect(countTree(tree)).toEqual({ machines: 5, guests: 8, stoppedGuests: 2, containers: 22 })
    expect(tree.unplaced).toEqual([])
  })

  it('lists machines sorted by name', () => {
    expect(tree.machines.map((m) => m.name)).toEqual([
      'host-print',
      'node-alpha',
      'node-beta',
      'node-gamma',
      'storage-nas',
    ])
  })

  it('attaches guests to the machine they run on', () => {
    const guests = Object.fromEntries(tree.machines.map((m) => [m.name, m.guests.map((g) => g.name)]))
    expect(guests).toEqual({
      'host-print': [],
      'node-alpha': ['vm-control', 'vm-home'],
      'node-beta': ['lxc-bastion', 'lxc-gateway-st', 'lxc-monitoring', 'vm-auth'],
      'node-gamma': ['vm-services', 'vm-worker'],
      'storage-nas': [],
    })
  })

  it('puts containers under the guest named by custom field host, grouped by stack', () => {
    const servicesGuest = guestByName('vm-services', tree)
    expect(servicesGuest.stacks.map((s) => s.name)).toContain('analytics')
    const analytics = servicesGuest.stacks.find((s) => s.name === 'analytics')
    expect(analytics?.containers.map((c) => c.name)).toEqual(['analytics-web'])
    expect(analytics?.containers[0]).toMatchObject({ image: 'analytics-web:latest', stack: 'analytics' })

    const placed = [
      ...tree.machines.flatMap((m) => m.apps),
      ...tree.machines
        .flatMap((m) => m.guests)
        .flatMap((g) => [...g.standalone, ...g.stacks.flatMap((s) => s.containers)]),
    ]
    expect(placed).toHaveLength(22)
  })

  it('keeps containers of "stack:standalone" outside any stack', () => {
    const standalone = tree.machines.flatMap((m) => m.guests).flatMap((g) => g.standalone)
    expect(standalone.length).toBeGreaterThan(0)
    expect(standalone.every((c) => c.stack === null)).toBe(true)
  })

  it('marks offline guests as stopped', () => {
    expect(guestByName('lxc-gateway-st', tree).state).toBe('stopped')
    expect(guestByName('lxc-monitoring', tree).state).toBe('stopped')
    expect(guestByName('vm-auth', tree).state).toBe('up')
  })

  it('links services via service_id and uses the status entry url', () => {
    const alpha = tree.machines.find((m) => m.name === 'node-alpha')
    expect(alpha?.services).toHaveLength(1)
    expect(alpha?.services[0]).toMatchObject({ name: 'proxmox-web', state: 'up' })
    expect(alpha?.services[0].url).toBe(statusEntries.find((e) => e.service_id === 17)?.url)
  })

  it('keeps services without a status entry as unknown, without a link', () => {
    const control = guestByName('vm-control', tree)
    const ingress = control.stacks.flatMap((s) => s.containers).find((c) => c.name.includes('ingress-proxy'))
    const unchecked = ingress?.services.find((s) => s.name === 'ingress-443')
    expect(unchecked).toMatchObject({ state: 'unknown', url: null })
    expect(ingress?.state).toBe('up')
  })

  it('derives a guest without own checks from what runs inside', () => {
    expect(guestByName('vm-services', tree).state).toBe('up')
    expect(tree.machines.find((m) => m.name === 'node-gamma')?.state).toBe('up')
  })
})

describe('buildTree: statuses', () => {
  it('shows everything unknown (stopped stays stopped) when statuses are missing', () => {
    const tree = buildTree(inventory)
    expect(guestByName('vm-services', tree).state).toBe('unknown')
    expect(guestByName('lxc-gateway-st', tree).state).toBe('stopped')
    const services = tree.machines.flatMap((m) => m.services)
    expect(services.every((s) => s.state === 'unknown' && s.url === null)).toBe(true)
  })

  it('reports a failing check as down and keeps its error', () => {
    const failing = withStatus((e) =>
      e.service_id === 17 ? { up: false, code: 0, error: 'timeout' } : {},
    )
    const alpha = buildTree(inventory, failing).machines.find((m) => m.name === 'node-alpha')
    expect(alpha?.state).toBe('down')
    expect(alpha?.services[0]).toMatchObject({ state: 'down', error: 'timeout' })
  })

  it('ignores status entries that belong to no NetBox service', () => {
    expect(statusEntries.some((e) => e.service_id === null)).toBe(true)
    expect(statuses.size).toBeLessThan(statusEntries.length)
  })
})

describe('buildTree: edge cases', () => {
  const empty: Inventory = { devices: [], vms: [], services: [] }
  const machine = { ...inventory.devices.find((d) => d.roleSlug === 'server')! }
  const docker = (patch: Partial<VmRecord>): VmRecord => ({
    ...inventory.vms.find((vm) => vm.kind === 'Docker')!,
    ...patch,
  })

  it('handles an empty inventory', () => {
    const tree = buildTree(empty)
    expect(tree).toEqual({ machines: [], unplaced: [] })
    expect(countTree(tree)).toEqual({ machines: 0, guests: 0, stoppedGuests: 0, containers: 0 })
  })

  it('ignores devices that are not servers', () => {
    const tree = buildTree({ ...empty, devices: inventory.devices.filter((d) => d.roleSlug !== 'server') })
    expect(tree.machines).toEqual([])
  })

  it('shows an app attached straight to a machine', () => {
    const app = docker({ id: '900', name: 'app-1', deviceId: machine.id, hostId: null, stack: 'web' })
    const tree = buildTree({ ...empty, devices: [machine], vms: [app] })
    expect(tree.machines[0].apps.map((a) => a.name)).toEqual(['app-1'])
    expect(tree.machines[0].apps[0].stack).toBe('web')
    expect(tree.unplaced).toEqual([])
    expect(countTree(tree).containers).toBe(1)
  })

  it('reports containers whose host cannot be resolved instead of dropping them', () => {
    const lost = docker({ id: '901', name: 'lost', hostId: '9999', deviceId: null })
    const tree = buildTree({ ...empty, devices: [machine], vms: [lost] })
    expect(tree.unplaced.map((c) => c.name)).toEqual(['lost'])
  })

  it('does not mix up a VM and a device that share a numeric id', () => {
    const service = { id: '1', name: 's', ports: [], scheme: null, addresses: [], parent: { kind: 'vm' as const, id: machine.id } }
    const tree = buildTree({ ...empty, devices: [machine], services: [service] })
    expect(tree.machines[0].services).toEqual([])
  })
})
