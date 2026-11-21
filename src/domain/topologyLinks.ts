import type { DeviceRecord } from './model'
import type { RawTopology, RawTopologyPort } from '../types/topology'

/**
 * Which cables the topology draws, kept apart from the graph model so the Hosts page can ask
 * "is this device on the diagram?" without loading the Topology chunk.
 */

export interface Link {
  id: string
  type: string | null
  a: RawTopologyPort
  b: RawTopologyPort
}

/** Cables whose both ports are known and whose both devices are on the page (not in reserve),
 * except a loop on one device. */
export function drawnLinks(topology: RawTopology, devices: readonly Pick<DeviceRecord, 'id'>[]): Link[] {
  const deviceIds = new Set(devices.map((d) => d.id))
  const ports = new Map(topology.ports.map((p) => [p.id, p]))
  const links: Link[] = []
  for (const cable of topology.cables) {
    const a = ports.get(cable.a)
    const b = ports.get(cable.b)
    if (!a || !b || !deviceIds.has(a.deviceId) || !deviceIds.has(b.deviceId) || a.deviceId === b.deviceId) continue
    links.push({ id: cable.id, type: cable.type, a, b })
  }
  return links
}

/** Ids of the devices drawn on the topology (those with at least one drawn cable). */
export function topologyDeviceIds(
  topology: RawTopology | null | undefined,
  devices: readonly Pick<DeviceRecord, 'id'>[],
): ReadonlySet<string> {
  if (!topology) return new Set()
  return new Set(drawnLinks(topology, devices).flatMap((l) => [l.a.deviceId, l.b.deviceId]))
}
