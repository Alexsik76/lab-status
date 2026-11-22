import { describe, expect, it } from 'vitest'
import { rawInventory } from '../__fixtures__'
import { topologyPayload } from '../__fixtures__/topology'
import { zigbeePayload } from '../__fixtures__/zigbee'
import { layoutKey } from '../presentation/topologyLayout'
import { normalizeInventory } from './normalize'
import { buildTopologyGraph } from './topology'
import {
  ZIGBEE_EDGE_ID,
  ZIGBEE_FRAME_ID,
  ZIGBEE_FRAME_PORT_ID,
  ZIGBEE_PORT_ID,
  mergeZigbeePlan,
  withZigbee,
  zigbeeAvailable,
  zigbeePlanKey,
} from './zigbeeGraph'

const devices = normalizeInventory(rawInventory).devices
const wired = buildTopologyGraph(topologyPayload, devices)
const build = (data = zigbeePayload) => {
  const { next } = mergeZigbeePlan(null, data)
  return { plan: next, graph: withZigbee(wired, next, zigbeeAvailable(data)) }
}

describe('Zigbee in the graph', () => {
  it('gives the coordinator one SOUTH zigbee port after its other ports', () => {
    const coordinator = build().graph.nodes.find((n) => n.id === '13')!
    const port = coordinator.ports.at(-1)!
    expect(port).toMatchObject({ id: ZIGBEE_PORT_ID, kind: 'zigbee', side: 'SOUTH', label: 'Zigbee', style: { kind: 'zigbee', vlan: null } })
    expect(port.order).toBeGreaterThan(Math.max(...coordinator.ports.slice(0, -1).map((p) => p.order)))
  })

  it('packs the devices into one frame by name, area else model, unavailable dimmed, not links', () => {
    const frame = build().graph.nodes.find((n) => n.id === ZIGBEE_FRAME_ID)!
    expect(frame).toMatchObject({ kind: 'zigbee-group', label: 'Zigbee · 3' })
    expect(frame.members!.map((m) => [m.name, m.model, m.offline, m.kind, m.isMachine, m.ports.length])).toEqual([
      ['Attic plug', 'PLUG-2', true, 'zigbee-device', false, 0],
      ['Hall button', 'Hall', false, 'zigbee-device', false, 0],
      ['Porch motion', 'Porch', false, 'zigbee-device', false, 0],
    ])
  })

  it('draws one bead line from the port to the frame top', () => {
    const { graph } = build()
    const line = graph.edges.filter((e) => e.medium === 'zigbee')
    expect(line).toEqual([expect.objectContaining({ id: ZIGBEE_EDGE_ID, source: ZIGBEE_PORT_ID, target: ZIGBEE_FRAME_PORT_ID, sourceDevice: '13', targetDevice: ZIGBEE_FRAME_ID, speed: null })])
    expect(graph.nodes.find((n) => n.id === ZIGBEE_FRAME_ID)!.ports).toEqual([expect.objectContaining({ id: ZIGBEE_FRAME_PORT_ID, side: 'NORTH', bare: true })])
  })

  it('shows the frame without a line when the coordinator is not on the diagram', () => {
    const { graph } = build({ ...zigbeePayload, coordinator: { deviceId: null, version: null } })
    expect(graph.nodes.some((n) => n.id === ZIGBEE_FRAME_ID)).toBe(true)
    expect(graph.edges.some((e) => e.medium === 'zigbee')).toBe(false)
    expect(graph.nodes.flatMap((n) => n.ports).some((p) => p.kind === 'zigbee' && !p.bare)).toBe(false)
  })

  it('keeps a device that disappears, dimmed; availability never changes the layout input', () => {
    const first = build()
    const gone = { ...zigbeePayload, devices: zigbeePayload.devices.filter((d) => d.id !== 'z3').map((d) => ({ ...d, available: !d.available })) }
    const { next, structural } = mergeZigbeePlan(first.plan, gone)
    expect(structural).toBe(false)
    const graph = withZigbee(wired, next, zigbeeAvailable(gone))
    const members = graph.nodes.find((n) => n.id === ZIGBEE_FRAME_ID)!.members!
    expect(members.map((m) => [m.name, m.offline])).toEqual([['Attic plug', false], ['Hall button', true], ['Porch motion', true]])
    expect(layoutKey(graph)).toBe(layoutKey(first.graph))
  })

  it('a new device or another coordinator is structural', () => {
    const { plan } = build()
    expect(mergeZigbeePlan(plan, { ...zigbeePayload, devices: [...zigbeePayload.devices, { ...zigbeePayload.devices[0], id: 'z9', name: 'New' }] }).structural).toBe(true)
    expect(mergeZigbeePlan(plan, { ...zigbeePayload, coordinator: { deviceId: '12', version: null } }).structural).toBe(true)
    expect(zigbeePlanKey(null)).toBe('')
  })
})
