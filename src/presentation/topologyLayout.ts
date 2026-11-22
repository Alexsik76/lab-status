import type { CableStyle, SpeedBucket, TopologyGraph, TopologyGroup, TopologyNode, TopologyPort } from '../domain/topology'

/**
 * The ELK input for a topology graph, the mapping of ELK's result to what the page draws,
 * and the drawing helpers (cable paths, colours, widths). Pure; the ELK call itself lives in
 * `useTopologyLayout`.
 */

// ---- card geometry ----

/**
 * A card is a fixed stack of single-line rows (`cardLines`); `TopologyCard.vue` renders each
 * row at exactly its height from `CARD_LINE_HEIGHT`, so the size given to ELK is the size drawn.
 * A new row on the card needs a new line kind here.
 */

export const PORT_PITCH = 42

/**
 * The jack of a switch-like device's port, by interface type: an RJ45 socket for copper
 * (`*base-t`, `*base-tx`), an SFP cage for the SFP family (`*-sfp`, `*-sfpp`, `*-sfp28`,
 * `*-qsfp*`, `*base-x-*`), a plain rectangle for anything else. All fit the port pitch.
 */
export type JackShape = 'rj45' | 'sfp' | 'plain' | 'radio'

export const JACK_SIZE: Readonly<Record<JackShape, { width: number; height: number }>> = {
  rj45: { width: 30, height: 22 },
  sfp: { width: 36, height: 18 },
  plain: { width: 24, height: 12 },
  /** A Wi-Fi radio (access point SSID) or a client's wireless interface: same box as RJ45. */
  radio: { width: 30, height: 22 },
}

/** The jack of a port: `radio` for Wi-Fi ports, else by interface type. */
export const portShape = (port: Pick<TopologyPort, 'kind' | 'type'>): JackShape =>
  port.kind === 'radio' ? 'radio' : jackShape(port.type)

/** Switch-like devices draw every port as a jack; others only their radio ports (else a dot). */
export const drawsJack = (node: Pick<TopologyNode, 'switchLike'>, port: Pick<TopologyPort, 'kind' | 'bare'>) =>
  !port.bare && (node.switchLike || port.kind === 'radio')

export function jackShape(type: string | null): JackShape {
  if (!type) return 'plain'
  const t = type.toLowerCase()
  if (/(^|-)q?sfp|base-x-/.test(t)) return 'sfp'
  if (/base-tx?$/.test(t)) return 'rj45'
  return 'plain'
}

/** The tallest jack sits half inside the card, centred on its edge. */
const JACK_MAX_HEIGHT = Math.max(...Object.values(JACK_SIZE).map((j) => j.height))
/** Longest port name shown in full next to a jack; longer ones are cut (tooltip has it all). */
export const JACK_NAME_MAX = PORT_PITCH - 4
const SWITCH_MIN_WIDTH = 330
export const CARD_WIDTH = 190
/** A Wi-Fi client card: name and address only. */
export const WIFI_CARD_WIDTH = 150

export type CardLine = 'title' | 'sub' | 'ip' | 'summary' | 'load'

export const CARD_LINE_HEIGHT: Readonly<Record<CardLine, number>> = {
  /** Icon, name and the state badge. */
  title: 22,
  /** Model, else role. */
  sub: 15,
  /** Primary IP. */
  ip: 15,
  /** A Hosts machine: guest and container counts. */
  summary: 18,
  /** A Hosts machine with Proxmox metrics: CPU and memory. */
  load: 15,
}

/** Padding above and below the rows. */
export const CARD_PADDING_Y = 9
/** The card's border (box-sizing: border-box), top and bottom. */
export const CARD_BORDER = 1
/** Port name size and its gap to the jack. */
export const JACK_LABEL_HEIGHT = 9
export const JACK_LABEL_GAP = 3
/**
 * Room for a jack row inside the card, added on each side that has jacks: the inner half of
 * the tallest jack, the gap and the port name.
 */
export const JACK_BAND_HEIGHT = JACK_MAX_HEIGHT / 2 + JACK_LABEL_GAP + JACK_LABEL_HEIGHT + 3
/** A radio port's label takes two lines (SSID, then channel / off / down). */
export const RADIO_LABEL_EXTRA = JACK_LABEL_HEIGHT + 1

/**
 * The title row: icon, name and state. The full state badge stays only where it fits beside a
 * 16-character name (about 134 px at 16 px); narrower cards show the state as a dot, with a
 * 15 px name and tighter gaps, so such a name still fits in an ordinary card.
 * Width budget: border 2 + padding 24 + icon 18 + gap 8 + name 134 + gap 8 + badge 101.
 */
export const FULL_BADGE_MIN_WIDTH = 2 * CARD_BORDER + 24 + 18 + 8 + 134 + 8 + 101

export type TitleBadge = 'full' | 'dot'

export const titleBadge = (cardWidth: number): TitleBadge => (cardWidth >= FULL_BADGE_MIN_WIDTH ? 'full' : 'dot')

export interface CardSize {
  width: number
  height: number
}

/** The rows a card shows, top to bottom. Depends only on what the layout key covers. */
export function cardLines(node: TopologyNode): CardLine[] {
  const lines: CardLine[] = ['title']
  if (node.model || node.roleSlug) lines.push('sub')
  // A Wi-Fi client always has its address row (empty while unknown): an address appearing
  // later must not change the card's height.
  if (node.ip || node.kind === 'wifi-client') lines.push('ip')
  if (node.isMachine) lines.push('summary')
  if (node.hasMetrics) lines.push('load')
  return lines
}

export function jackBands(node: TopologyNode): { north: boolean; south: boolean } {
  const drawn = (side: string) => node.ports.some((p) => p.side === side && drawsJack(node, p))
  return { north: drawn('NORTH'), south: drawn('SOUTH') }
}

/** Room for the jacks on one side inside the card: 0 without jacks, more with radio labels. */
export function jackBandHeight(node: TopologyNode, side: 'NORTH' | 'SOUTH'): number {
  const ports = node.ports.filter((p) => p.side === side && drawsJack(node, p))
  if (!ports.length) return 0
  return JACK_BAND_HEIGHT + (ports.some((p) => p.kind === 'radio') ? RADIO_LABEL_EXTRA : 0)
}

/** Inside a Wi-Fi client frame: padding (the label chip sits on the bottom border) and gaps. */
export const FRAME_PADDING = { top: 12, left: 10, right: 10, bottom: 16 }
export const FRAME_GAP = 8
export const FRAME_COLUMNS = 2

export interface FrameSlot {
  id: string
  /** Relative to the frame. */
  x: number
  y: number
  width: number
  height: number
}

/**
 * The client cards of a frame in a grid of at most two columns, in member order (by name),
 * row by row; the frame's size follows. ELK gets the frame as one node of this size.
 */
export function packFrame(members: readonly TopologyNode[]): { width: number; height: number; slots: FrameSlot[] } {
  const columns = Math.max(1, Math.min(FRAME_COLUMNS, members.length))
  const sizes = members.map((m) => cardSize(m))
  const cellW = Math.max(0, ...sizes.map((s) => s.width))
  const cellH = Math.max(0, ...sizes.map((s) => s.height))
  const rows = Math.ceil(members.length / columns)
  const slots = members.map((m, i) => ({
    id: m.id,
    x: FRAME_PADDING.left + (i % columns) * (cellW + FRAME_GAP),
    y: FRAME_PADDING.top + Math.floor(i / columns) * (cellH + FRAME_GAP),
    width: cellW,
    height: cellH,
  }))
  return {
    width: FRAME_PADDING.left + FRAME_PADDING.right + columns * cellW + (columns - 1) * FRAME_GAP,
    height: FRAME_PADDING.top + FRAME_PADDING.bottom + rows * cellH + Math.max(0, rows - 1) * FRAME_GAP,
    slots,
  }
}

export function cardSize(node: TopologyNode): CardSize {
  if (node.kind === 'wifi-group') {
    const { width, height } = packFrame(node.members ?? [])
    return { width, height }
  }
  const rows = cardLines(node).reduce((sum, line) => sum + CARD_LINE_HEIGHT[line], 0)
  const height = 2 * (CARD_BORDER + CARD_PADDING_Y) + rows + jackBandHeight(node, 'NORTH') + jackBandHeight(node, 'SOUTH')
  if (node.kind === 'wifi-client') return { width: WIFI_CARD_WIDTH, height }
  if (!node.switchLike) return { width: CARD_WIDTH, height }
  const south = node.ports.filter((p) => p.side === 'SOUTH').length
  const north = node.ports.length - south
  // An access point or a single-uplink switch is an ordinary card; a jack row needs its pitch.
  // The 330 minimum is for a row of copper / SFP ports: an access point's radio ports only
  // add their pitch, so an AP with a few radios stays an ordinary card.
  const southCable = node.ports.filter((p) => p.side === 'SOUTH' && p.kind !== 'radio').length
  const jacksWidth = Math.max(south, north) * PORT_PITCH + 40
  const width = southCable <= 1 ? Math.max(CARD_WIDTH, jacksWidth) : Math.max(SWITCH_MIN_WIDTH, jacksWidth)
  return { width, height }
}

// ---- ELK input ----

/**
 * Options measured on real data for a compact result (see README, Topology). No
 * post-compaction: it pulls every card up on its own and breaks the rows into stairs.
 */
export const LAYOUT_OPTIONS: Readonly<Record<string, string>> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': '64',
  'elk.spacing.nodeNode': '20',
  'elk.spacing.edgeEdge': '16',
  'elk.spacing.edgeNode': '26',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
  'elk.layered.spacing.edgeNodeBetweenLayers': '26',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
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

export interface ElkGroupInput {
  id: string
  layoutOptions: Record<string, string>
  children: ElkNodeInput[]
}

export interface ElkGraphInput {
  id: string
  layoutOptions: Record<string, string>
  children: (ElkNodeInput | ElkGroupInput)[]
  edges: { id: string; sources: string[]; targets: string[] }[]
}

/** Room around the members of a group; the top holds its label. */
export const GROUP_PADDING = { top: 28, left: 12, bottom: 12, right: 12 }

export const nodeKey = (deviceId: string) => `d${deviceId}`
export const portKey = (portId: string) => `p${portId}`
export const edgeKey = (cableId: string) => `c${cableId}`
export const groupKey = (groupId: string) => `g${groupId}`

/**
 * Switch-like devices keep their ports in NetBox order (FIXED_ORDER). ELK counts
 * `elk.port.index` clockwise from the top-left corner: NORTH ports left to right, then SOUTH
 * ports right to left, so the SOUTH ones are indexed from the right to read left to right.
 * Other devices only fix the side (FIXED_SIDE) and let ELK order their entry points.
 */
export function toElkGraph(graph: TopologyGraph): ElkGraphInput {
  const nodes = graph.nodes.map((node): ElkNodeInput => {
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
        width: drawsJack(node, p) ? JACK_SIZE[portShape(p)].width : 0,
        height: 0,
        layoutOptions: {
          'elk.port.side': p.side,
          ...(node.switchLike ? { 'elk.port.index': String(index.get(p.id)) } : {}),
        },
      })),
    }
  })
  // Members of a group are children of the group's node; edges stay declared at the root.
  const byId = new Map(graph.nodes.map((n, i) => [n.id, nodes[i]]))
  const grouped = new Set(graph.groups.flatMap((g) => g.memberIds))
  const { top, left, bottom, right } = GROUP_PADDING
  const groups = graph.groups.map(
    (g): ElkGroupInput => ({
      id: groupKey(g.id),
      layoutOptions: { 'elk.padding': `[top=${top},left=${left},bottom=${bottom},right=${right}]` },
      children: g.memberIds.map((id) => byId.get(id)!),
    }),
  )
  const children = [...nodes.filter((_, i) => !grouped.has(graph.nodes[i].id)), ...groups]
  return {
    id: 'root',
    layoutOptions: { ...LAYOUT_OPTIONS, ...(groups.length ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : {}) },
    children,
    edges: graph.edges.map((e) => ({ id: edgeKey(e.id), sources: [portKey(e.source)], targets: [portKey(e.target)] })),
  }
}

/** Changes only when what ELK lays out changes: devices, ports, cables, card sizes and groups. */
export function layoutKey(graph: TopologyGraph): string {
  return JSON.stringify(toElkGraph(graph))
}

// ---- ELK result ----

export interface Point {
  x: number
  y: number
}

interface ElkResultNode {
  id: string
  x?: number
  y?: number
  width?: number
  height?: number
  ports?: { id: string; x?: number; y?: number; width?: number; height?: number }[]
  children?: ElkResultNode[]
}

export interface ElkResult extends ElkResultNode {
  edges?: {
    id: string
    /** The node the coordinates are relative to (elkjs sets it with hierarchical layouts). */
    container?: string
    sections?: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[]
  }[]
}

export interface PlacedNode {
  x: number
  y: number
  width: number
  height: number
  /** Port centres relative to the card, by port id. */
  ports: Map<string, Point>
}

export interface PlacedGroup {
  group: TopologyGroup
  x: number
  y: number
  width: number
  height: number
}

export interface Placement {
  width: number
  height: number
  /** Absolute canvas coordinates, also for members of a group. */
  nodes: Map<string, PlacedNode>
  /** Cable polylines (absolute), by cable id. */
  edges: Map<string, Point[]>
  groups: PlacedGroup[]
}

/** ELK gives a child's position relative to its parent: everything here is made absolute. */
export function readPlacement(graph: TopologyGraph, result: ElkResult): Placement {
  const absolute = new Map<string, { node: ElkResultNode; x: number; y: number }>()
  const walk = (node: ElkResultNode, ox: number, oy: number) => {
    const x = ox + (node.x ?? 0)
    const y = oy + (node.y ?? 0)
    absolute.set(node.id, { node, x, y })
    for (const child of node.children ?? []) walk(child, x, y)
  }
  walk({ ...result, x: 0, y: 0 }, 0, 0)

  const nodes = new Map<string, PlacedNode>()
  for (const node of graph.nodes) {
    const at = absolute.get(nodeKey(node.id))
    if (!at) continue
    const ports = new Map<string, Point>()
    for (const p of at.node.ports ?? []) {
      ports.set(p.id.slice(1), { x: (p.x ?? 0) + (p.width ?? 0) / 2, y: (p.y ?? 0) + (p.height ?? 0) / 2 })
    }
    nodes.set(node.id, { x: at.x, y: at.y, width: at.node.width ?? 0, height: at.node.height ?? 0, ports })
  }

  const groups: PlacedGroup[] = []
  for (const group of graph.groups) {
    const at = absolute.get(groupKey(group.id))
    if (at) groups.push({ group, x: at.x, y: at.y, width: at.node.width ?? 0, height: at.node.height ?? 0 })
  }

  const edgesById = new Map((result.edges ?? []).map((e) => [e.id, e]))
  const edges = new Map<string, Point[]>()
  for (const edge of graph.edges) {
    const elkEdge = edgesById.get(edgeKey(edge.id))
    const section = elkEdge?.sections?.[0]
    if (!section) continue
    const origin = elkEdge.container ? absolute.get(elkEdge.container) : undefined
    const ox = origin?.x ?? 0
    const oy = origin?.y ?? 0
    edges.set(
      edge.id,
      [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: p.x + ox, y: p.y + oy })),
    )
  }
  return { width: result.width ?? 0, height: result.height ?? 0, nodes, edges, groups }
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
export const PALETTE_VIDS: ReadonlySet<number> = new Set([1, 10, 20, 30, 40, 50, 60, 61, 70, 80, 90, 100])

const GOLDEN_ANGLE = 137.508
const FALLBACK_LIGHTNESS = [0.7, 0.8, 0.62] as const

/**
 * Colour of a vid without a token: a hue stepped by the golden angle per vid (neighbouring
 * vids land far apart on the wheel) and one of three lightness levels, so the colour is stable
 * and two unlisted VLANs differ.
 */
export function fallbackVlanColor(vid: number): string {
  const hue = ((vid * GOLDEN_ANGLE) % 360).toFixed(2)
  const lightness = FALLBACK_LIGHTNESS[vid % FALLBACK_LIGHTNESS.length]
  return `oklch(${lightness} 0.13 ${hue})`
}

export const vlanColor = (vid: number) => (PALETTE_VIDS.has(vid) ? `var(--color-vlan-${vid})` : fallbackVlanColor(vid))

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
