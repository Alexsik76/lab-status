import type { CableStyle, SpeedBucket, TopologyGraph, TopologyNode } from '../domain/topology'

/**
 * The ELK input for a topology graph, the mapping of ELK's result to what the page draws,
 * and the drawing helpers (cable paths, colours, widths). Pure; the ELK call itself lives in
 * `useTopologyLayout`.
 */

// ---- card geometry ----

export const PORT_PITCH = 54
export const JACK_WIDTH = 24
const SWITCH_MIN_WIDTH = 330
const CARD_WIDTH = 210
/** Icon + name, role or model, address. */
const CARD_BASE_HEIGHT = 70
/** The summary of a Hosts machine (state and counts, then the load). */
const SUMMARY_HEIGHT = 34
/** Port names next to a jack row. */
const JACK_BAND_HEIGHT = 24

export interface CardSize {
  width: number
  height: number
}

export function cardSize(node: TopologyNode): CardSize {
  const south = node.ports.filter((p) => p.side === 'SOUTH').length
  const north = node.ports.length - south
  let height = CARD_BASE_HEIGHT + (node.isMachine ? SUMMARY_HEIGHT : 0)
  if (!node.switchLike) return { width: CARD_WIDTH, height }
  if (south) height += JACK_BAND_HEIGHT
  if (north) height += JACK_BAND_HEIGHT
  return { width: Math.max(SWITCH_MIN_WIDTH, Math.max(south, north) * PORT_PITCH + 40), height }
}

// ---- ELK input ----

/** Options that gave a good result on real data (see README, Topology). */
export const LAYOUT_OPTIONS: Readonly<Record<string, string>> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': '64',
  'elk.spacing.nodeNode': '34',
  'elk.spacing.edgeEdge': '16',
  'elk.spacing.edgeNode': '26',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
  'elk.layered.spacing.edgeNodeBetweenLayers': '26',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
  'elk.layered.thoroughness': '40',
  'elk.padding': '[top=28,left=28,bottom=28,right=28]',
}

export interface ElkPortInput {
  id: string
  width: number
  height: number
  layoutOptions: Record<string, string>
}

export interface ElkNodeInput {
  id: string
  width: number
  height: number
  layoutOptions: Record<string, string>
  ports: ElkPortInput[]
}

export interface ElkGraphInput {
  id: string
  layoutOptions: Record<string, string>
  children: ElkNodeInput[]
  edges: { id: string; sources: string[]; targets: string[] }[]
}

export const nodeKey = (deviceId: string) => `d${deviceId}`
export const portKey = (portId: string) => `p${portId}`
export const edgeKey = (cableId: string) => `c${cableId}`

/**
 * Switch-like devices keep their ports in NetBox order (FIXED_ORDER). ELK counts
 * `elk.port.index` clockwise from the top-left corner: NORTH ports left to right, then SOUTH
 * ports right to left, so the SOUTH ones are indexed from the right to read left to right.
 * Other devices only fix the side (FIXED_SIDE) and let ELK order their entry points.
 */
export function toElkGraph(graph: TopologyGraph): ElkGraphInput {
  const children = graph.nodes.map((node): ElkNodeInput => {
    const size = cardSize(node)
    const north = node.ports.filter((p) => p.side === 'NORTH')
    const south = node.ports.filter((p) => p.side === 'SOUTH')
    const index = new Map<string, number>()
    north.forEach((p, i) => index.set(p.id, i))
    south.forEach((p, i) => index.set(p.id, north.length + (south.length - 1 - i)))
    return {
      id: nodeKey(node.id),
      ...size,
      layoutOptions: { 'elk.portConstraints': node.switchLike ? 'FIXED_ORDER' : 'FIXED_SIDE' },
      ports: node.ports.map((p) => ({
        id: portKey(p.id),
        width: node.switchLike ? JACK_WIDTH : 0,
        height: 0,
        layoutOptions: {
          'elk.port.side': p.side,
          ...(node.switchLike ? { 'elk.port.index': String(index.get(p.id)) } : {}),
        },
      })),
    }
  })
  return {
    id: 'root',
    layoutOptions: { ...LAYOUT_OPTIONS },
    children,
    edges: graph.edges.map((e) => ({ id: edgeKey(e.id), sources: [portKey(e.source)], targets: [portKey(e.target)] })),
  }
}

/** Changes only when what ELK lays out changes: devices, ports, cables and card sizes. */
export function layoutKey(graph: TopologyGraph): string {
  return JSON.stringify(toElkGraph(graph))
}

// ---- ELK result ----

export interface Point {
  x: number
  y: number
}

export interface ElkResult {
  width?: number
  height?: number
  children?: {
    id: string
    x?: number
    y?: number
    width?: number
    height?: number
    ports?: { id: string; x?: number; y?: number; width?: number; height?: number }[]
  }[]
  edges?: { id: string; sections?: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[] }[]
}

export interface PlacedNode {
  x: number
  y: number
  width: number
  height: number
  /** Port centres relative to the card, by port id. */
  ports: Map<string, Point>
}

export interface Placement {
  width: number
  height: number
  nodes: Map<string, PlacedNode>
  /** Cable polylines (absolute), by cable id. */
  edges: Map<string, Point[]>
}

export function readPlacement(graph: TopologyGraph, result: ElkResult): Placement {
  const children = new Map((result.children ?? []).map((c) => [c.id, c]))
  const edgesById = new Map((result.edges ?? []).map((e) => [e.id, e]))
  const nodes = new Map<string, PlacedNode>()
  for (const node of graph.nodes) {
    const c = children.get(nodeKey(node.id))
    if (!c) continue
    const ports = new Map<string, Point>()
    for (const p of c.ports ?? []) {
      ports.set(p.id.slice(1), { x: (p.x ?? 0) + (p.width ?? 0) / 2, y: (p.y ?? 0) + (p.height ?? 0) / 2 })
    }
    nodes.set(node.id, { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0, ports })
  }
  const edges = new Map<string, Point[]>()
  for (const edge of graph.edges) {
    const section = edgesById.get(edgeKey(edge.id))?.sections?.[0]
    if (section) edges.set(edge.id, [section.startPoint, ...(section.bendPoints ?? []), section.endPoint])
  }
  return { width: result.width ?? 0, height: result.height ?? 0, nodes, edges }
}

// ---- drawing ----

/** An orthogonal polyline as an SVG path with rounded corners (radius clamped to the segments). */
export function roundedPath(points: readonly Point[], radius = 9): string {
  if (points.length < 2) return ''
  const fmt = (n: number) => String(Math.round(n * 10) / 10)
  let d = `M${fmt(points[0].x)},${fmt(points[0].y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const lenIn = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const lenOut = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(radius, lenIn / 2, lenOut / 2)
    if (r <= 0) {
      d += ` L${fmt(cur.x)},${fmt(cur.y)}`
      continue
    }
    const inX = cur.x - ((cur.x - prev.x) / lenIn) * r
    const inY = cur.y - ((cur.y - prev.y) / lenIn) * r
    const outX = cur.x + ((next.x - cur.x) / lenOut) * r
    const outY = cur.y + ((next.y - cur.y) / lenOut) * r
    d += ` L${fmt(inX)},${fmt(inY)} Q${fmt(cur.x)},${fmt(cur.y)} ${fmt(outX)},${fmt(outY)}`
  }
  const last = points[points.length - 1]
  return `${d} L${fmt(last.x)},${fmt(last.y)}`
}

const WIDTHS: Record<SpeedBucket, number> = { '10G': 8, '2.5G': 4, '1G': 2.4, '100M': 1.4 }

/** Stroke width by speed; a cable without a known speed is drawn like 1G. */
export const cableWidth = (speed: SpeedBucket | null) => WIDTHS[speed ?? '1G']

/**
 * A trunk is a light cable with a dark core: drawn 1.6 px wider than its speed width so the
 * core (half the speed width + 0.4 px) stays visible on thin cables at the smallest scale.
 */
export const trunkWidths = (speed: SpeedBucket | null) => {
  const w = cableWidth(speed)
  return { outer: w + 1.6, core: w / 2 + 0.4 }
}

/** The speed tag is shown for everything but 1G (and unknown). */
export const speedTag = (speed: SpeedBucket | null) => (speed && speed !== '1G' ? speed : null)

/** VLANs with their own colour token (`--color-vlan-<vid>` in tokens.css). */
export const PALETTE_VIDS: ReadonlySet<number> = new Set([1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])

export const vlanColor = (vid: number) =>
  PALETTE_VIDS.has(vid) ? `var(--color-vlan-${vid})` : 'var(--color-vlan-other)'

/** Stroke colour of a cable (and its jacks). */
export function styleColor(style: CableStyle): string {
  if (style.kind === 'trunk') return 'var(--color-cable-trunk)'
  if (style.kind === 'access' && style.vlan !== null) return vlanColor(style.vlan)
  return 'var(--color-cable-unknown)'
}

export const MIN_SCALE = 0.6

/** Fit to the container width, never above 1 and not below 0.6 (then it scrolls). */
export function fitScale(containerWidth: number, diagramWidth: number): number {
  if (diagramWidth <= 0 || containerWidth <= 0) return 1
  return Math.min(1, Math.max(MIN_SCALE, containerWidth / diagramWidth))
}
