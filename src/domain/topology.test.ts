import { describe, expect, it } from 'vitest'
import { rawInventory } from '../__fixtures__'
import { topologyPayload } from '../__fixtures__/topology'
import type { RawTopology, RawTopologyPort } from '../types/topology'
import type { DeviceRecord } from './model'
import { normalizeInventory } from './normalize'
import {
  buildTopologyGraph,
  cableSpeed,
  cableStyle,
  findGroups,
  GROUP_DEFINITIONS,
  nominalSpeedKbps,
  speedBucket,
} from './topology'
import { topologyDeviceIds } from './topologyLinks'

const devices = normalizeInventory(rawInventory).devices
const machines = new Set(devices.filter((d) => d.roleSlug === 'server').map((d) => d.id))
const graph = buildTopologyGraph(topologyPayload, devices, machines)

const port = (extra: Partial<RawTopologyPort> = {}): RawTopologyPort => ({
  id: 'x',
  deviceId: 'd',
  name: 'p',
  order: 0,
  type: null,
  speedKbps: null,
  mode: null,
  untagged: null,
  tagged: [],
  mgmtOnly: false,
  ...extra,
})

const device = (id: string, name: string, roleSlug: string | null, extra: Partial<DeviceRecord> = {}): DeviceRecord => ({
  id,
  name,
  roleSlug,
  offline: false,
  model: null,
  manufacturer: null,
  ip: null,
  cluster: null,
  platform: null,
  icon: null,
  tags: [],
  hardware: { cpuCores: null, memoryGb: null, storageGb: null },
  ...extra,
})

describe('buildTopologyGraph', () => {
  it('has every cabled device as a node and every cable as an edge', () => {
    expect(graph.nodes.map((n) => n.name)).toEqual([
      'gw-router-01',
      'host-print',
      'sw-core-01',
      'node-alpha',
      'node-beta',
      'node-gamma',
      'storage-nas',
    ])
    expect(graph.edges).toHaveLength(7)
    // The Hosts page's question gives the same set without building the graph.
    expect([...topologyDeviceIds(topologyPayload, devices)].sort()).toEqual(graph.nodes.map((n) => n.id).sort())
    expect(topologyDeviceIds(null, devices).size).toBe(0)
  })

  it('orients cables from the router down, SOUTH on the shallower end and NORTH on the deeper', () => {
    const byName = new Map(graph.nodes.map((n) => [n.name, n]))
    expect(byName.get('gw-router-01')!.depth).toBe(0)
    expect(byName.get('sw-core-01')!.depth).toBe(1)
    expect(byName.get('storage-nas')!.depth).toBe(2)

    const uplink = graph.edges.find((e) => e.id === '1')!
    expect([uplink.sourceDevice, uplink.targetDevice]).toEqual(['1', '2'])
    // Cable 3 is stored switch -> server, cable 2 server -> switch: both run from the switch.
    const c2 = graph.edges.find((e) => e.id === '2')!
    expect([c2.source, c2.target]).toEqual(['202', '1101'])

    const sw = byName.get('sw-core-01')!
    expect(sw.ports.map((p) => [p.name, p.side])).toEqual([
      ['sfp1', 'NORTH'],
      ['port2', 'SOUTH'],
      ['port3', 'SOUTH'],
      ['port4', 'SOUTH'],
      ['port5', 'SOUTH'],
      ['port6', 'SOUTH'],
    ])
    expect(byName.get('storage-nas')!.ports.every((p) => p.side === 'NORTH')).toBe(true)
  })

  it('marks switch-like devices and Hosts machines, and carries the card fields', () => {
    const byName = new Map(graph.nodes.map((n) => [n.name, n]))
    expect(byName.get('gw-router-01')!.switchLike).toBe(true)
    expect(byName.get('sw-core-01')!.switchLike).toBe(true)
    expect(byName.get('node-alpha')!.switchLike).toBe(false)
    expect(byName.get('node-alpha')!.isMachine).toBe(true)
    expect(byName.get('sw-core-01')!.isMachine).toBe(false)
    expect(byName.get('node-alpha')!.ip).toBe('192.0.2.11')
  })

  it('styles and sizes the cables, and lists only what the legend needs', () => {
    const edge = (id: string) => graph.edges.find((e) => e.id === id)!
    expect(edge('1').style).toEqual({ kind: 'trunk', vlan: null })
    expect(edge('1').speed).toBe('10G')
    expect(edge('2').style).toEqual({ kind: 'access', vlan: 20 })
    expect(edge('3').speed).toBe('2.5G')
    expect(edge('4').style).toEqual({ kind: 'unknown', vlan: null })
    expect(edge('7')).toMatchObject({ style: { kind: 'access', vlan: 30 }, speed: '100M' })
    expect(graph.vlans).toEqual([
      { vid: 20, name: 'servers' },
      { vid: 30, name: 'printers' },
    ])
    expect(graph.hasTrunk && graph.hasUnknown).toBe(true)
    expect(graph.speeds).toEqual(['10G', '2.5G', '1G', '100M'])
    // The jack is drawn like its cable.
    const nas = graph.nodes.find((n) => n.name === 'storage-nas')!
    expect(nas.ports.map((p) => p.style.kind)).toEqual(['access', 'unknown'])
  })

  it('drops cables to devices that are not on the page and loops on one device', () => {
    const topo: RawTopology = {
      vlans: [],
      ports: [port({ id: 'a', deviceId: '1' }), port({ id: 'b', deviceId: '99' }), port({ id: 'c', deviceId: '1' })],
      cables: [
        { id: '1', type: null, a: 'a', b: 'b' },
        { id: '2', type: null, a: 'a', b: 'c' },
        { id: '3', type: null, a: 'a', b: 'missing' },
      ],
    }
    const g = buildTopologyGraph(topo, [device('1', 'r', 'router')])
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
  })

  it('roots a part the router does not reach at its switch, then by cable count', () => {
    const topo: RawTopology = {
      vlans: [],
      ports: [
        port({ id: 'h1', deviceId: 'h' }),
        port({ id: 's1', deviceId: 's', order: 0 }),
        port({ id: 's2', deviceId: 's', order: 1 }),
        port({ id: 'k1', deviceId: 'k' }),
      ],
      cables: [
        { id: '1', type: null, a: 'h1', b: 's1' },
        { id: '2', type: null, a: 'k1', b: 's2' },
      ],
    }
    const g = buildTopologyGraph(topo, [device('h', 'a-host', 'server'), device('s', 'z-switch', 'switch'), device('k', 'b-host', 'server')])
    expect(g.nodes.map((n) => [n.name, n.depth])).toEqual([
      ['z-switch', 0],
      ['a-host', 1],
      ['b-host', 1],
    ])
    expect(g.edges.every((e) => e.sourceDevice === 's')).toBe(true)
  })

  it('directs a cable between devices at the same depth from the switch-like one', () => {
    const topo: RawTopology = {
      vlans: [],
      ports: [
        port({ id: 'r1', deviceId: 'r', order: 0 }),
        port({ id: 'r2', deviceId: 'r', order: 1 }),
        port({ id: 'h1', deviceId: 'h', order: 0 }),
        port({ id: 'h2', deviceId: 'h', order: 1 }),
        port({ id: 'a1', deviceId: 'a', order: 0 }),
        port({ id: 'a2', deviceId: 'a', order: 1 }),
      ],
      cables: [
        { id: '1', type: null, a: 'r1', b: 'h1' },
        { id: '2', type: null, a: 'r2', b: 'a1' },
        { id: '3', type: null, a: 'h2', b: 'a2' },
      ],
    }
    const g = buildTopologyGraph(topo, [device('r', 'rt', 'router'), device('h', 'host', 'server'), device('a', 'ap', 'access-point')])
    const cross = g.edges.find((e) => e.id === '3')!
    expect([cross.sourceDevice, cross.targetDevice]).toEqual(['a', 'h'])
  })
})

describe('cableStyle', () => {
  it('is a trunk when either end is tagged by mode or by VLAN list', () => {
    expect(cableStyle(port({ mode: 'tagged' }), port()).kind).toBe('trunk')
    expect(cableStyle(port(), port({ mode: 'tagged-all' })).kind).toBe('trunk')
    expect(cableStyle(port({ untagged: 10 }), port({ tagged: [20] })).kind).toBe('trunk')
  })

  it('is access in the untagged VLAN of either end', () => {
    expect(cableStyle(port({ mode: 'access', untagged: 10 }), port())).toEqual({ kind: 'access', vlan: 10 })
    expect(cableStyle(port(), port({ untagged: 40 }))).toEqual({ kind: 'access', vlan: 40 })
  })

  it('is unknown without VLAN data on both ends', () => {
    expect(cableStyle(port({ mode: 'access' }), port())).toEqual({ kind: 'unknown', vlan: null })
  })
})

describe('speeds', () => {
  it('reads the nominal speed of an interface type', () => {
    expect(nominalSpeedKbps('1000base-t')).toBe(1_000_000)
    expect(nominalSpeedKbps('100base-tx')).toBe(100_000)
    expect(nominalSpeedKbps('2.5gbase-t')).toBe(2_500_000)
    expect(nominalSpeedKbps('10gbase-x-sfpp')).toBe(10_000_000)
    expect(nominalSpeedKbps('virtual')).toBeNull()
    expect(nominalSpeedKbps(null)).toBeNull()
  })

  it('buckets speeds into 10G / 2.5G / 1G / 100M', () => {
    expect(speedBucket(25_000_000)).toBe('10G')
    expect(speedBucket(5_000_000)).toBe('2.5G')
    expect(speedBucket(1_000_000)).toBe('1G')
    expect(speedBucket(100_000)).toBe('100M')
    expect(speedBucket(null)).toBeNull()
  })

  it('prefers the configured speed and takes the lower end', () => {
    expect(cableSpeed(port({ type: '10gbase-x-sfpp' }), port({ type: '1000base-t' }))).toBe('1G')
    expect(cableSpeed(port({ type: '10gbase-x-sfpp', speedKbps: 1_000_000 }), port({ type: '10gbase-x-sfpp' }))).toBe('1G')
    expect(cableSpeed(port({ type: '2.5gbase-t' }), port({ type: 'virtual' }))).toBe('2.5G')
    expect(cableSpeed(port(), port())).toBeNull()
  })
})

describe('groups', () => {
  it('groups devices of a grouped role that hang off one upstream device, with their common VLAN', async () => {
    const { groupDevices, groupTopology } = await import('../__fixtures__/topologyGroups')
    const g = buildTopologyGraph(groupTopology, groupDevices)
    const cams = g.groups.find((x) => x.definitionId === 'cameras')!
    expect(cams).toEqual({
      id: 'cameras:3',
      definitionId: 'cameras',
      label: 'Cameras',
      roleSlug: 'camera',
      upstreamId: '3',
      memberIds: ['31', '32', '33'],
      vlan: 40,
    })
    // A lone camera, and a camera cabled to two devices, are not grouped.
    const grouped = new Set(g.groups.flatMap((x) => x.memberIds))
    expect(grouped.has('21')).toBe(false)
    expect(grouped.has('22')).toBe(false)
  })

  it('groups a platform wherever its members are cabled; a device matching both rules is in the role group', async () => {
    const { groupDevices, groupTopology } = await import('../__fixtures__/topologyGroups')
    const g = buildTopologyGraph(groupTopology, groupDevices)
    const hv = g.groups.find((x) => x.definitionId === 'proxmox')!
    // cam-yard (33) is on the platform too, but the camera rule comes first.
    expect(hv).toMatchObject({ id: 'proxmox', label: 'Proxmox nodes', roleSlug: null, upstreamId: null, memberIds: ['41', '42'] })
    expect(hv.vlan).toBeNull() // VLAN 60 and 10 on its cables
  })

  it('does not group cameras on different switches, nor a single platform device', async () => {
    const { device } = await import('../__fixtures__/topologyGroups')
    const topo: RawTopology = {
      vlans: [],
      ports: [
        port({ id: 'r1', deviceId: 'r', order: 0 }),
        port({ id: 'r2', deviceId: 'r', order: 1 }),
        port({ id: 'r3', deviceId: 'r', order: 2 }),
        port({ id: 'a1', deviceId: 'a', order: 0 }),
        port({ id: 'b1', deviceId: 'b', order: 0 }),
        port({ id: 'a2', deviceId: 'a', order: 1 }),
        port({ id: 'b2', deviceId: 'b', order: 1 }),
        port({ id: 'h1', deviceId: 'h', order: 0 }),
        port({ id: 'c1', deviceId: 'c1', order: 0 }),
        port({ id: 'c2', deviceId: 'c2', order: 0 }),
      ],
      cables: [
        { id: '1', type: null, a: 'r1', b: 'a1' },
        { id: '2', type: null, a: 'r2', b: 'b1' },
        { id: '3', type: null, a: 'a2', b: 'c1' },
        { id: '4', type: null, a: 'b2', b: 'c2' },
        { id: '5', type: null, a: 'r3', b: 'h1' },
      ],
    }
    const g = buildTopologyGraph(topo, [
      device('r', 'rt', 'router'),
      device('a', 'sw-a', 'switch'),
      device('b', 'sw-b', 'switch'),
      device('c1', 'cam-1', 'camera'),
      device('c2', 'cam-2', 'camera'),
      device('h', 'hv', 'server', 'Proxmox VE'),
    ])
    expect(g.groups).toEqual([])
  })

  it('makes adding a group one entry', async () => {
    const { groupDevices, groupTopology } = await import('../__fixtures__/topologyGroups')
    const g = buildTopologyGraph(groupTopology, groupDevices)
    const extra = findGroups(g.nodes, g.edges, [
      ...GROUP_DEFINITIONS,
      { id: 'switches', label: 'Switches', rule: { kind: 'role', role: 'switch' } },
    ])
    // core-switch hangs off the router only; cam-switch has many neighbours: no group of two.
    expect(extra.map((x) => x.id)).toEqual(['cameras:3', 'proxmox'])
    const nvr = findGroups(g.nodes, g.edges, [{ id: 'nvr', label: 'Recorders', rule: { kind: 'role', role: 'nvr' } }])
    expect(nvr).toEqual([]) // one recorder only
  })
})
