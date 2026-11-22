import type { TopologyEdge, TopologyGraph, TopologyNode, TopologyPort } from './topology'
import type { ZigbeeData } from '../types/zigbee'

/**
 * The Zigbee network in the diagram: one `zigbee` port on the coordinator (the NetBox device
 * with the `zigbee-socket` service), one frame with every Zigbee device, and one bead line
 * between them. The real mesh routes are not known here and not drawn. Pure.
 *
 * As for Wi-Fi, the layout sees a sticky plan: every device seen since the page was opened
 * (one that disappears stays, dimmed); a new device or another coordinator is structural;
 * availability, names, areas and models never are.
 */

export interface PlannedZigbeeDevice {
  id: string
  name: string
  /** The card's second line: the area, else the model. */
  detail: string | null
}

export interface ZigbeePlan {
  coordinatorId: string | null
  /** By name. */
  devices: PlannedZigbeeDevice[]
}

export const ZIGBEE_PORT_ID = 'zigbee:port'
export const ZIGBEE_FRAME_ID = 'zigbee:frame'
export const ZIGBEE_FRAME_PORT_ID = 'zigbee:frame-port'
export const ZIGBEE_EDGE_ID = 'zigbee:line'
export const zigbeeNodeId = (id: string) => `zigbee:${id}`
/** On the frame (its title attribute): the line is not the mesh. */
export const ZIGBEE_MESH_NOTE = 'Zigbee devices of the coordinator; the real mesh routes are not shown'

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function zigbeePlanKey(plan: ZigbeePlan | null): string {
  if (!plan) return ''
  return JSON.stringify([plan.coordinatorId, plan.devices.map((d) => d.id)])
}

export function mergeZigbeePlan(prev: ZigbeePlan | null, data: ZigbeeData): { next: ZigbeePlan; structural: boolean } {
  const devices = new Map((prev?.devices ?? []).map((d) => [d.id, d]))
  for (const d of data.devices) devices.set(d.id, { id: d.id, name: d.name, detail: d.area ?? d.model })
  const next: ZigbeePlan = {
    coordinatorId: data.coordinator.deviceId,
    devices: [...devices.values()].sort((a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1)),
  }
  return { next, structural: zigbeePlanKey(next) !== zigbeePlanKey(prev) }
}

/** Ids of the devices present and available right now. */
export function zigbeeAvailable(data: ZigbeeData | null): ReadonlySet<string> {
  return new Set((data?.devices ?? []).filter((d) => d.available).map((d) => d.id))
}

/**
 * The graph with the coordinator's `zigbee` port (SOUTH, after its other ports), the frame of
 * devices (ELK sees one node; members are cards without ports) and the bead line from the port
 * to the frame's top edge. Without the coordinator on the diagram: the frame alone, no line.
 */
export function withZigbee(graph: TopologyGraph, plan: ZigbeePlan, available: ReadonlySet<string>): TopologyGraph {
  const coordinator = plan.coordinatorId ? graph.nodes.find((n) => n.id === plan.coordinatorId) : undefined
  const style = { kind: 'zigbee' as const, vlan: null }
  let nodes = graph.nodes
  const edges: TopologyEdge[] = []
  if (coordinator) {
    const port: TopologyPort = {
      id: ZIGBEE_PORT_ID,
      deviceId: coordinator.id,
      name: 'Zigbee',
      order: Math.max(-1, ...coordinator.ports.map((p) => p.order)) + 1,
      type: null,
      side: 'SOUTH',
      cableId: plan.devices.length ? ZIGBEE_EDGE_ID : '',
      style,
      mgmtOnly: false,
      kind: 'zigbee',
      label: 'Zigbee',
    }
    const side = (p: TopologyPort) => Number(p.side === 'SOUTH')
    nodes = nodes.map((n) =>
      n.id === coordinator.id ? { ...n, ports: [...n.ports, port].sort((p, q) => side(p) - side(q) || p.order - q.order) } : n,
    )
  }
  if (!plan.devices.length) return { ...graph, nodes }

  const members: TopologyNode[] = plan.devices.map((d) => ({
    id: zigbeeNodeId(d.id),
    name: d.name,
    roleSlug: null,
    model: d.detail,
    ip: null,
    icon: null,
    platform: null,
    offline: !available.has(d.id),
    switchLike: false,
    isMachine: false,
    hasMetrics: false,
    depth: 0,
    ports: [],
    kind: 'zigbee-device',
    inFrame: true,
  }))
  const depth = coordinator ? coordinator.depth + 1 : Math.max(0, ...graph.nodes.map((n) => n.depth)) + 1
  const frame: TopologyNode = {
    id: ZIGBEE_FRAME_ID,
    name: 'Zigbee',
    roleSlug: null,
    model: null,
    ip: null,
    icon: null,
    platform: null,
    offline: members.every((m) => m.offline),
    switchLike: false,
    isMachine: false,
    hasMetrics: false,
    depth,
    ports: coordinator
      ? [
          {
            id: ZIGBEE_FRAME_PORT_ID,
            deviceId: ZIGBEE_FRAME_ID,
            name: 'Zigbee',
            order: 0,
            type: null,
            side: 'NORTH',
            cableId: ZIGBEE_EDGE_ID,
            style,
            mgmtOnly: false,
            kind: 'zigbee',
            bare: true,
          },
        ]
      : [],
    kind: 'zigbee-group',
    members,
    label: `Zigbee · ${members.length}`,
  }
  if (coordinator) {
    edges.push({
      id: ZIGBEE_EDGE_ID,
      source: ZIGBEE_PORT_ID,
      target: ZIGBEE_FRAME_PORT_ID,
      sourceDevice: coordinator.id,
      targetDevice: ZIGBEE_FRAME_ID,
      cableType: null,
      style,
      speed: null,
      medium: 'zigbee',
    })
  }
  return { ...graph, nodes: [...nodes, frame], edges: [...graph.edges, ...edges] }
}
