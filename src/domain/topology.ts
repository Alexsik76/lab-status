import type { DeviceRecord } from './model'
import type { RawTopology, RawTopologyPort, RawTopologyVlan } from '../types/topology'
import { drawnLinks, type Link } from './topologyLinks'

/**
 * The physical network as a graph: devices with at least one cable are nodes, cables are
 * edges. Pure; the layout (ELK) and the rendering build on it.
 */

/** Devices whose ports are drawn as a jack row, in NetBox order. */
export const SWITCH_LIKE_ROLES: ReadonlySet<string> = new Set(['router', 'switch', 'access-point'])
const ROOT_ROLE = 'router'

export type CableKind = 'trunk' | 'access' | 'unknown' | 'zigbee'

export interface CableStyle {
  kind: CableKind
  /** The untagged VLAN of an access cable; null otherwise. */
  vlan: number | null
}

export type SpeedBucket = '10G' | '2.5G' | '1G' | '100M'

/** SOUTH on the end nearer the root, NORTH on the farther one. */
export type PortSide = 'NORTH' | 'SOUTH'

export interface TopologyPort {
  id: string
  deviceId: string
  name: string
  order: number
  /** NetBox interface type value (decides the jack drawn). */
  type: string | null
  side: PortSide
  cableId: string
  /** The style of the cable plugged in: the jack is drawn like its cable. */
  style: CableStyle
  mgmtOnly: boolean
  /**
   * `radio`: a Wi-Fi radio (an access point's SSID) or a client's wireless interface.
   * `zigbee`: the Zigbee coordinator's port.
   */
  kind?: 'cable' | 'radio' | 'zigbee'
  /** Label of a radio port, e.g. `Home · 5180` (the jack shows it on two lines). */
  label?: string
  /** A radio that is disabled or down: drawn dimmed, no links. */
  off?: boolean
  /** No jack and no dot: where a Wi-Fi line meets a client frame's top edge. */
  bare?: boolean
  /** A jack without its name and without a jack band (a group member keeps its card size). */
  compact?: boolean
}

export interface TopologyNode {
  /** The NetBox device id. */
  id: string
  name: string
  roleSlug: string | null
  model: string | null
  ip: string | null
  icon: string | null
  platform: string | null
  offline: boolean
  switchLike: boolean
  /** The device is a machine on the Hosts page. */
  isMachine: boolean
  /** A Hosts machine with Proxmox metrics: its card has a load line. */
  hasMetrics: boolean
  /** Cables away from the root (0 for a root). */
  depth: number
  /** NORTH ports, then SOUTH ports, each in NetBox order. */
  ports: TopologyPort[]
  /**
   * `wifi-client`: a wireless client not otherwise on the diagram (title + IP).
   * `wifi-group`: a frame packing the Wi-Fi-only clients of one radio (two or more), laid out
   * by ELK as one node of fixed size; its `members` are positioned inside it by the page.
   * `zigbee-group` / `zigbee-device`: the same for the Zigbee devices (name, area or model).
   */
  kind?: 'device' | 'wifi-client' | 'wifi-group' | 'zigbee-device' | 'zigbee-group'
  /** The NetBox device behind the card, when not the node id itself (a Wi-Fi client's). */
  deviceId?: string | null
  /** A `wifi-group`'s clients, sorted by name (cards without ports). */
  members?: TopologyNode[]
  /** A `wifi-group`'s label, e.g. `Home · 5180 · 3`. */
  label?: string
  /** A member of a `wifi-group`: no port of its own, a Wi-Fi glyph before its name. */
  inFrame?: boolean
}

export interface TopologyEdge {
  id: string
  /** Port ids: from the shallower device to the deeper one. */
  source: string
  target: string
  sourceDevice: string
  targetDevice: string
  cableType: string | null
  style: CableStyle
  speed: SpeedBucket | null
  /**
   * `wifi`: from an access point's radio to a client, drawn as a wavy line.
   * `zigbee`: from the coordinator's port to the Zigbee frame, drawn as beads.
   */
  medium?: 'cable' | 'wifi' | 'zigbee'
}

/**
 * A rectangle of devices drawn together. One entry per kind of group: adding a group is one
 * more entry. Rules are tried in this order; a device belongs to at most one group.
 * - `role`: devices with this role slug whose every cable goes to one and the same device
 *   (their upstream); one group per upstream device.
 * - `platform`: devices on this NetBox platform, wherever they are cabled.
 * A group needs at least two members.
 */
export type GroupRule = { kind: 'role'; role: string } | { kind: 'platform'; platform: string }

export interface GroupDefinition {
  id: string
  label: string
  rule: GroupRule
}

export const GROUP_DEFINITIONS: readonly GroupDefinition[] = [
  { id: 'cameras', label: 'Cameras', rule: { kind: 'role', role: 'camera' } },
  { id: 'proxmox', label: 'Proxmox nodes', rule: { kind: 'platform', platform: 'Proxmox VE' } },
]

const MIN_GROUP_SIZE = 2

export interface TopologyGroup {
  /** `<definition id>` or `<definition id>:<upstream device id>` for a role group. */
  id: string
  definitionId: string
  label: string
  /** The grouped role (role rule), else null. */
  roleSlug: string | null
  /** The device every member is cabled to (role rule), else null. */
  upstreamId: string | null
  /** Member device ids, in node order. */
  memberIds: string[]
  /** The VLAN of all the members' cables when they are access cables of one VLAN, else null. */
  vlan: number | null
}

export interface TopologyGraph {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  groups: TopologyGroup[]
  /** VLANs used by the access cables on the diagram, by vid; a vid unknown to NetBox gets its number. */
  vlans: RawTopologyVlan[]
  /** Some cable is a trunk / has no VLAN data: the legend lists only what is drawn. */
  hasTrunk: boolean
  hasUnknown: boolean
  speeds: SpeedBucket[]
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

const TRUNK_MODES: ReadonlySet<string> = new Set(['tagged', 'tagged-all'])

const isTrunkPort = (p: RawTopologyPort) => (p.mode !== null && TRUNK_MODES.has(p.mode)) || p.tagged.length > 0

/**
 * Trunk when either end is tagged (mode or tagged VLANs); access in the untagged VLAN of
 * either end (the first end's wins); unknown when neither end has VLAN data. A VLAN is never
 * guessed from addresses.
 */
export function cableStyle(a: RawTopologyPort, b: RawTopologyPort): CableStyle {
  if (isTrunkPort(a) || isTrunkPort(b)) return { kind: 'trunk', vlan: null }
  const vlan = a.untagged ?? b.untagged
  return vlan != null ? { kind: 'access', vlan } : { kind: 'unknown', vlan: null }
}

/**
 * Nominal speed of a NetBox interface type, in kbit/s: `1000base-t` -> 1 000 000,
 * `2.5gbase-t` -> 2 500 000, `10gbase-x-sfpp` -> 10 000 000; null for types without one.
 */
export function nominalSpeedKbps(type: string | null): number | null {
  const m = type?.match(/^(\d+(?:\.\d+)?)(g|m)?base/i)
  if (!m) return null
  const value = Number.parseFloat(m[1])
  return Math.round(m[2]?.toLowerCase() === 'g' ? value * 1_000_000 : value * 1_000)
}

const portSpeed = (p: RawTopologyPort) => (p.speedKbps && p.speedKbps > 0 ? p.speedKbps : nominalSpeedKbps(p.type))

export function speedBucket(kbps: number | null): SpeedBucket | null {
  if (kbps === null) return null
  if (kbps >= 10_000_000) return '10G'
  if (kbps >= 2_500_000) return '2.5G'
  if (kbps >= 1_000_000) return '1G'
  return '100M'
}

/** A cable runs at the lower speed of its two ends; ends without a speed do not count. */
export function cableSpeed(a: RawTopologyPort, b: RawTopologyPort): SpeedBucket | null {
  const known = [portSpeed(a), portSpeed(b)].filter((s): s is number => s !== null)
  return speedBucket(known.length ? Math.min(...known) : null)
}

/**
 * Depth of every device: BFS over the cables from the router (devices with role `router`).
 * A part of the network the router does not reach starts from its own best root: a
 * switch-like device first, then the one with most cables, then by name.
 */
function depths(deviceIds: string[], links: Link[], byId: ReadonlyMap<string, DeviceRecord>): Map<string, number> {
  const neighbours = new Map<string, string[]>(deviceIds.map((id) => [id, []]))
  for (const l of links) {
    neighbours.get(l.a.deviceId)!.push(l.b.deviceId)
    neighbours.get(l.b.deviceId)!.push(l.a.deviceId)
  }
  const degree = (id: string) => neighbours.get(id)!.length
  const switchLike = (id: string) => SWITCH_LIKE_ROLES.has(byId.get(id)?.roleSlug ?? '')
  const byName = (a: string, b: string) => collator.compare(byId.get(a)!.name, byId.get(b)!.name) || collator.compare(a, b)

  const depth = new Map<string, number>()
  const walk = (roots: string[]) => {
    let frontier = roots.filter((r) => !depth.has(r))
    for (const r of frontier) depth.set(r, 0)
    let level = 0
    while (frontier.length) {
      level++
      const next: string[] = []
      for (const id of frontier) {
        for (const n of neighbours.get(id)!) {
          if (!depth.has(n)) {
            depth.set(n, level)
            next.push(n)
          }
        }
      }
      frontier = next
    }
  }

  walk(deviceIds.filter((id) => byId.get(id)?.roleSlug === ROOT_ROLE).sort(byName))
  for (;;) {
    const rest = deviceIds.filter((id) => !depth.has(id))
    if (!rest.length) break
    rest.sort((a, b) => Number(switchLike(b)) - Number(switchLike(a)) || degree(b) - degree(a) || byName(a, b))
    walk([rest[0]])
  }
  return depth
}

export function buildTopologyGraph(
  topology: RawTopology,
  devices: readonly DeviceRecord[],
  machineIds: ReadonlySet<string> = new Set(),
  metricIds: ReadonlySet<string> = new Set(),
): TopologyGraph {
  const byId = new Map(devices.map((d) => [d.id, d]))
  const portsById = new Map(topology.ports.map((p) => [p.id, p]))

  const links = drawnLinks(topology, devices)

  const deviceIds = [...new Set(links.flatMap((l) => [l.a.deviceId, l.b.deviceId]))]
  const depth = depths(deviceIds, links, byId)
  const degree = new Map<string, number>()
  for (const l of links) for (const d of [l.a.deviceId, l.b.deviceId]) degree.set(d, (degree.get(d) ?? 0) + 1)
  const isSwitchLike = (id: string) => SWITCH_LIKE_ROLES.has(byId.get(id)?.roleSlug ?? '')

  /** Whether `a` is the upper end: shallower; at equal depth switch-like, more cables, then by name. */
  const aIsUpper = (a: string, b: string) => {
    const da = depth.get(a)!
    const db = depth.get(b)!
    if (da !== db) return da < db
    if (isSwitchLike(a) !== isSwitchLike(b)) return isSwitchLike(a)
    const ga = degree.get(a)!
    const gb = degree.get(b)!
    if (ga !== gb) return ga > gb
    return collator.compare(byId.get(a)!.name, byId.get(b)!.name) <= 0
  }

  const portsByDevice = new Map<string, TopologyPort[]>()
  const edges: TopologyEdge[] = []
  for (const l of links) {
    const [upper, lower] = aIsUpper(l.a.deviceId, l.b.deviceId) ? [l.a, l.b] : [l.b, l.a]
    const style = cableStyle(upper, lower)
    edges.push({
      id: l.id,
      source: upper.id,
      target: lower.id,
      sourceDevice: upper.deviceId,
      targetDevice: lower.deviceId,
      cableType: l.type,
      style,
      speed: cableSpeed(upper, lower),
    })
    for (const [port, side] of [[upper, 'SOUTH'], [lower, 'NORTH']] as const) {
      const list = portsByDevice.get(port.deviceId) ?? []
      list.push({
        id: port.id,
        deviceId: port.deviceId,
        name: port.name,
        order: port.order,
        type: port.type,
        side,
        cableId: l.id,
        style,
        mgmtOnly: port.mgmtOnly,
      })
      portsByDevice.set(port.deviceId, list)
    }
  }

  const nodes: TopologyNode[] = deviceIds
    .map((id) => {
      const d = byId.get(id)!
      const ports = (portsByDevice.get(id) ?? []).sort(
        (p, q) => Number(p.side === 'SOUTH') - Number(q.side === 'SOUTH') || p.order - q.order,
      )
      return {
        id,
        name: d.name,
        roleSlug: d.roleSlug,
        model: d.model,
        ip: d.ip,
        icon: d.icon,
        platform: d.platform,
        offline: d.offline,
        switchLike: isSwitchLike(id),
        isMachine: machineIds.has(id),
        hasMetrics: machineIds.has(id) && metricIds.has(id),
        depth: depth.get(id)!,
        ports,
      }
    })
    .sort((a, b) => a.depth - b.depth || collator.compare(a.name, b.name))

  edges.sort((e, f) => {
    const pe = portsById.get(e.source)!
    const pf = portsById.get(f.source)!
    return (depth.get(e.sourceDevice)! - depth.get(f.sourceDevice)!) || collator.compare(e.sourceDevice, f.sourceDevice) || pe.order - pf.order
  })

  const groups = findGroups(nodes, edges)

  const vlanNames = new Map(topology.vlans.map((v) => [v.vid, v.name]))
  const vids = [...new Set(edges.map((e) => e.style.vlan).filter((v): v is number => v !== null))].sort((a, b) => a - b)
  const present = new Set(edges.map((e) => e.speed).filter((s): s is SpeedBucket => s !== null))
  return {
    nodes,
    edges,
    groups,
    vlans: vids.map((vid) => ({ vid, name: vlanNames.get(vid) ?? '' })),
    hasTrunk: edges.some((e) => e.style.kind === 'trunk'),
    hasUnknown: edges.some((e) => e.style.kind === 'unknown'),
    speeds: (['10G', '2.5G', '1G', '100M'] as const).filter((s) => present.has(s)),
  }
}

/**
 * The VLAN of a group: the one VLAN of all its members' links (cables or Wi-Fi) when they are
 * all access links of that VLAN, else null.
 */
export function groupVlan(memberIds: readonly string[], edges: readonly TopologyEdge[]): number | null {
  const members = new Set(memberIds)
  const styles = edges.filter((e) => members.has(e.sourceDevice) || members.has(e.targetDevice)).map((e) => e.style)
  const first = styles[0]
  if (!first || first.kind !== 'access') return null
  return styles.every((s) => s.kind === 'access' && s.vlan === first.vlan) ? first.vlan : null
}

/** Groups by `GROUP_DEFINITIONS`, earlier definitions first; members keep the node order. */
export function findGroups(
  nodes: readonly TopologyNode[],
  edges: readonly TopologyEdge[],
  definitions: readonly GroupDefinition[] = GROUP_DEFINITIONS,
): TopologyGroup[] {
  const neighbours = new Map<string, Set<string>>()
  const cables = new Map<string, TopologyEdge[]>()
  for (const e of edges) {
    for (const [d, other] of [[e.sourceDevice, e.targetDevice], [e.targetDevice, e.sourceDevice]]) {
      if (!neighbours.has(d)) neighbours.set(d, new Set())
      neighbours.get(d)!.add(other)
      cables.set(d, [...(cables.get(d) ?? []), e])
    }
  }
  const taken = new Set<string>()
  const groups: TopologyGroup[] = []

  const commonVlan = (memberIds: string[]) => groupVlan(memberIds, edges)
  const add = (def: GroupDefinition, id: string, memberIds: string[], roleSlug: string | null, upstreamId: string | null) => {
    if (memberIds.length < MIN_GROUP_SIZE) return
    for (const m of memberIds) taken.add(m)
    groups.push({ id, definitionId: def.id, label: def.label, roleSlug, upstreamId, memberIds, vlan: commonVlan(memberIds) })
  }

  for (const def of definitions) {
    const free = nodes.filter((n) => !taken.has(n.id))
    if (def.rule.kind === 'role') {
      const role = def.rule.role
      const byUpstream = new Map<string, string[]>()
      for (const n of free) {
        const around = neighbours.get(n.id)
        if (n.roleSlug !== role || !around || around.size !== 1) continue
        const upstream = [...around][0]
        byUpstream.set(upstream, [...(byUpstream.get(upstream) ?? []), n.id])
      }
      for (const [upstream, members] of byUpstream) {
        // The upstream itself cannot be a member of the group that hangs off it.
        add(def, `${def.id}:${upstream}`, members.filter((m) => m !== upstream), role, upstream)
      }
    } else {
      const platform = def.rule.platform
      add(def, def.id, free.filter((n) => n.platform === platform).map((n) => n.id), null, null)
    }
  }
  return groups
}

/** What a device is directly connected to on the diagram (one hop). */
export interface Trace {
  /** Cables with the device at either end. */
  edgeIds: ReadonlySet<string>
  /** The device itself and the devices at the other ends of its cables. */
  nodeIds: ReadonlySet<string>
  /** The ports at both ends of those cables. */
  portIds: ReadonlySet<string>
}

/** The device's cables, neighbours and their ports; all empty for an id not on the graph. */
export function traceOf(graph: Pick<TopologyGraph, 'nodes' | 'edges'>, deviceId: string): Trace {
  const edgeIds = new Set<string>()
  const nodeIds = new Set<string>()
  const portIds = new Set<string>()
  if (!graph.nodes.some((n) => n.id === deviceId)) return { edgeIds, nodeIds, portIds }
  nodeIds.add(deviceId)
  for (const e of graph.edges) {
    if (e.sourceDevice !== deviceId && e.targetDevice !== deviceId) continue
    edgeIds.add(e.id)
    nodeIds.add(e.sourceDevice)
    nodeIds.add(e.targetDevice)
    portIds.add(e.source)
    portIds.add(e.target)
  }
  return { edgeIds, nodeIds, portIds }
}
