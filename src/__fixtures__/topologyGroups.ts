import type { DeviceRecord } from '../domain/model'
import type { RawTopology, RawTopologyPort } from '../types/topology'

/**
 * Synthetic network for the group rules (invented names): a router, a core switch, a camera
 * switch with three cameras (VLAN 40) and a recorder, a lone camera on the core switch, a camera
 * cabled to both switches, two hypervisors on different switches (one also cabled to the
 * router), and a camera on the hypervisor platform (it belongs to the camera group).
 */
export const device = (id: string, name: string, roleSlug: string | null, platform: string | null = null): DeviceRecord => ({
  id,
  name,
  roleSlug,
  offline: false,
  model: null,
  manufacturer: null,
  ip: null,
  cluster: null,
  platform,
  icon: null,
  tags: [],
  hardware: { cpuCores: null, memoryGb: null, storageGb: null },
})

export const groupDevices: DeviceRecord[] = [
  device('1', 'edge-router', 'router'),
  device('2', 'core-switch', 'switch'),
  device('3', 'cam-switch', 'switch'),
  device('31', 'cam-north', 'camera'),
  device('32', 'cam-south', 'camera'),
  device('33', 'cam-yard', 'camera', 'Proxmox VE'),
  device('34', 'recorder', 'nvr'),
  device('21', 'cam-lone', 'camera'),
  device('22', 'cam-both', 'camera'),
  device('41', 'hv-one', 'server', 'Proxmox VE'),
  device('42', 'hv-two', 'server', 'Proxmox VE'),
]

const ports: RawTopologyPort[] = []
const cables: RawTopology['cables'] = []
let nextPort = 100
const counters = new Map<string, number>()

function port(deviceId: string, type: string, extra: Partial<RawTopologyPort> = {}): string {
  const id = String(nextPort++)
  const order = counters.get(deviceId) ?? 0
  counters.set(deviceId, order + 1)
  ports.push({
    id,
    deviceId,
    name: `p${order}`,
    order,
    type,
    speedKbps: null,
    mode: null,
    untagged: null,
    tagged: [],
    mgmtOnly: false,
    ...extra,
  })
  return id
}

function cable(a: string, b: string, aType = '1000base-t', bType = '1000base-t', extra: Partial<RawTopologyPort> = {}) {
  cables.push({ id: String(cables.length + 1), type: 'cat6', a: port(a, aType, extra), b: port(b, bType, extra) })
}

cable('1', '2', '10gbase-x-sfpp', '10gbase-x-sfpp', { mode: 'tagged', tagged: [40, 60] })
cable('2', '3', '1000base-x-sfp', '1000base-x-sfp', { mode: 'tagged', tagged: [40] })
for (const cam of ['31', '32', '33']) cable('3', cam, '100base-tx', '100base-tx', { untagged: 40 })
cable('3', '34', '1000base-t', '1000base-t', { untagged: 40 })
cable('2', '21', '1000base-t', '1000base-t', { untagged: 40 })
cable('2', '22')
cable('3', '22')
cable('2', '41', '2.5gbase-t', '2.5gbase-t', { untagged: 60 })
cable('1', '41', '1000base-t', '1000base-t', { untagged: 10 })
cable('3', '42', '1000base-t', '1000base-t', { untagged: 60 })

export const groupTopology: RawTopology = {
  vlans: [
    { vid: 40, name: 'cams' },
    { vid: 60, name: 'hv' },
  ],
  ports,
  cables,
}
