import type { CableStyle, TopologyEdge, TopologyGraph, TopologyNode, TopologyPort } from './topology'
import type { WifiBand, WifiData } from '../types/wifi'

/**
 * Wireless devices as part of the diagram: radio ports on access points (one per AP x SSID),
 * Wi-Fi clients as ports on their existing cards or as cards of their own, and one Wi-Fi edge
 * per client. Pure.
 *
 * What the layout sees is a *plan*, not the live data: the radios and the clients known since
 * the page was opened, each client on the radio it was last laid out on. A client that
 * disconnects stays in the plan (its card dims, its line goes); live values (channel, radio
 * state, names, addresses) never change the plan's structure. Only a new client, a client on
 * another radio, or a change in the radios themselves is structural (see `mergePlan`).
 */

export interface PlannedRadio {
  /** `<apId>|<ssid>|<band>`. */
  key: string
  apId: string
  /** The access point's NetBox device (a node on the diagram). */
  apDeviceId: string
  ssid: string
  band: WifiBand | null
  vlan: number | null
}

export interface PlannedClient {
  mac: string
  /** The radio it is laid out on. */
  radioKey: string
  name: string
  deviceId: string | null
  ip: string | null
}

export interface WifiPlan {
  /** In network order (the grid's rows), then by access point. */
  radios: PlannedRadio[]
  /** Every client seen since the page was opened (sticky), by MAC order. */
  clients: PlannedClient[]
}

export const radioKey = (apId: string, ssid: string, band: string | null) => `${apId}|${ssid}|${band ?? ''}`

/** The radios of the live data on access points known to NetBox, in network order. */
function liveRadios(wifi: WifiData): PlannedRadio[] {
  const apDevice = new Map(wifi.aps.map((ap) => [ap.id, ap.deviceId]))
  const networkIndex = new Map(wifi.networks.map((n, i) => [`${n.ssid}|${n.band ?? ''}`, i]))
  const vlanOf = new Map(wifi.networks.map((n) => [`${n.ssid}|${n.band ?? ''}`, n.vlan]))
  const seen = new Set<string>()
  const radios: PlannedRadio[] = []
  for (const r of wifi.radios) {
    const apDeviceId = apDevice.get(r.apId)
    if (!apDeviceId) continue
    const key = radioKey(r.apId, r.ssid, r.band)
    if (seen.has(key)) continue
    seen.add(key)
    radios.push({ key, apId: r.apId, apDeviceId, ssid: r.ssid, band: r.band, vlan: vlanOf.get(`${r.ssid}|${r.band ?? ''}`) ?? null })
  }
  const order = (r: PlannedRadio) => networkIndex.get(`${r.ssid}|${r.band ?? ''}`) ?? Number.MAX_SAFE_INTEGER
  return radios.sort((a, b) => order(a) - order(b) || (a.apId < b.apId ? -1 : a.apId > b.apId ? 1 : 0))
}

/** What the layout depends on; equal keys mean an equal ELK input from the Wi-Fi side. */
export function planKey(plan: WifiPlan | null): string {
  if (!plan) return ''
  return JSON.stringify([
    plan.radios.map((r) => [r.key, r.apDeviceId]),
    plan.clients.map((c) => [c.mac, c.radioKey, c.deviceId]),
  ])
}

/**
 * The next plan from the current one and fresh live data, and whether it changes the layout.
 * Disconnected clients are kept; a connected client's name and address follow the live data
 * without counting as a change.
 */
export function mergePlan(prev: WifiPlan | null, wifi: WifiData): { next: WifiPlan; structural: boolean } {
  const radios = liveRadios(wifi)
  const radioKeys = new Set(radios.map((r) => r.key))
  const clients = new Map((prev?.clients ?? []).map((c) => [c.mac, c]))
  for (const live of wifi.clients) {
    const key = radioKey(live.apId, live.ssid, live.band)
    if (!radioKeys.has(key)) continue
    clients.set(live.mac, { mac: live.mac, radioKey: key, name: live.name, deviceId: live.deviceId, ip: live.ip })
  }
  // A kept client whose radio is gone has nowhere to hang: it leaves the plan.
  const next: WifiPlan = {
    radios,
    clients: [...clients.values()].filter((c) => radioKeys.has(c.radioKey)).sort((a, b) => (a.mac < b.mac ? -1 : 1)),
  }
  return { next, structural: planKey(next) !== planKey(prev) }
}

/** Live state for drawing a laid-out plan: who is connected where, and each radio's label. */
export interface WifiLive {
  /** MACs connected right now to the radio they are laid out on. */
  connected: ReadonlySet<string>
  radios: ReadonlyMap<string, { channel: number | null; state: 'running' | 'disabled' | 'down' | 'gone' }>
}

export function wifiLive(plan: WifiPlan, wifi: WifiData | null): WifiLive {
  const liveKey = new Map((wifi?.clients ?? []).map((c) => [c.mac, radioKey(c.apId, c.ssid, c.band)]))
  const connected = new Set(plan.clients.filter((c) => liveKey.get(c.mac) === c.radioKey).map((c) => c.mac))
  const radios = new Map<string, { channel: number | null; state: 'running' | 'disabled' | 'down' | 'gone' }>()
  for (const r of plan.radios) radios.set(r.key, { channel: null, state: 'gone' })
  for (const r of wifi?.radios ?? []) {
    const key = radioKey(r.apId, r.ssid, r.band)
    if (radios.has(key) && radios.get(key)!.state !== 'running') radios.set(key, { channel: r.channel, state: r.state })
  }
  return { connected, radios }
}

/** `Home · 5180`, `Home · off` (disabled), `Home · down`. */
export function radioLabel(ssid: string, live: { channel: number | null; state: string } | undefined): string {
  if (!live || live.state === 'disabled' || live.state === 'gone') return `${ssid} · off`
  if (live.state === 'down') return `${ssid} · down`
  return live.channel !== null ? `${ssid} · ${live.channel}` : ssid
}

export const radioPortId = (key: string) => `radio:${key}`
export const clientPortId = (mac: string) => `wlan:${mac}`
export const clientNodeId = (mac: string) => `wifi:${mac}`
export const wifiEdgeId = (mac: string) => `wifi:${mac}`

const styleOf = (vlan: number | null): CableStyle => (vlan !== null ? { kind: 'access', vlan } : { kind: 'unknown', vlan: null })

/**
 * The wired graph with the plan's radio ports, client ports / cards and Wi-Fi edges. Radios and
 * clients of access points that are not on the diagram are left out. Radio ports are added
 * after an access point's copper ports (SOUTH); a client's port is NORTH. `live` only sets
 * labels and `off` on radio ports; the structure (what ELK sees) comes from the plan alone.
 */
export function withWifi(
  graph: TopologyGraph,
  plan: WifiPlan,
  live: WifiLive,
  machineIds: ReadonlySet<string> = new Set(),
): TopologyGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const radios = plan.radios.filter((r) => byId.has(r.apDeviceId))
  if (!radios.length) return graph
  const radioByKey = new Map(radios.map((r) => [r.key, r]))

  const extraPorts = new Map<string, TopologyPort[]>()
  const addPort = (nodeId: string, port: TopologyPort) => extraPorts.set(nodeId, [...(extraPorts.get(nodeId) ?? []), port])

  // Radio ports, after the access point's copper ports.
  const nextOrder = new Map<string, number>()
  for (const r of radios) {
    const ap = byId.get(r.apDeviceId)!
    const order = nextOrder.get(ap.id) ?? Math.max(-1, ...ap.ports.map((p) => p.order)) + 1
    nextOrder.set(ap.id, order + 1)
    const state = live.radios.get(r.key)
    addPort(ap.id, {
      id: radioPortId(r.key),
      deviceId: ap.id,
      name: r.ssid,
      order,
      type: null,
      side: 'SOUTH',
      cableId: '',
      style: styleOf(r.vlan),
      mgmtOnly: false,
      kind: 'radio',
      label: radioLabel(r.ssid, state),
      off: !state || state.state !== 'running',
    })
  }

  // Clients: a port on an existing card, or a card of their own.
  const newNodes: TopologyNode[] = []
  const edges: TopologyEdge[] = []
  for (const c of plan.clients) {
    const radio = radioByKey.get(c.radioKey)
    if (!radio) continue
    const ap = byId.get(radio.apDeviceId)!
    const existing = c.deviceId !== null && c.deviceId !== ap.id ? byId.get(c.deviceId) : undefined
    const nodeId = existing ? existing.id : clientNodeId(c.mac)
    const port: TopologyPort = {
      id: clientPortId(c.mac),
      deviceId: nodeId,
      name: 'wlan',
      order: 10_000,
      type: null,
      side: 'NORTH',
      cableId: wifiEdgeId(c.mac),
      style: styleOf(radio.vlan),
      mgmtOnly: false,
      kind: 'radio',
      label: 'wlan',
      off: !live.connected.has(c.mac),
    }
    if (existing) {
      addPort(existing.id, port)
    } else {
      newNodes.push({
        id: nodeId,
        name: c.name,
        roleSlug: null,
        model: null,
        ip: c.ip,
        icon: null,
        platform: null,
        offline: !live.connected.has(c.mac),
        switchLike: false,
        isMachine: c.deviceId !== null && machineIds.has(c.deviceId),
        hasMetrics: false,
        depth: ap.depth + 1,
        ports: [port],
        kind: 'wifi-client',
        deviceId: c.deviceId,
      })
    }
    edges.push({
      id: wifiEdgeId(c.mac),
      source: radioPortId(radio.key),
      target: port.id,
      sourceDevice: ap.id,
      targetDevice: nodeId,
      cableType: null,
      style: styleOf(radio.vlan),
      speed: null,
      medium: 'wifi',
    })
  }

  const side = (p: TopologyPort) => Number(p.side === 'SOUTH')
  const nodes = graph.nodes.map((n) => {
    const more = extraPorts.get(n.id)
    if (!more) return n
    return { ...n, ports: [...n.ports, ...more].sort((p, q) => side(p) - side(q) || p.order - q.order) }
  })
  return { ...graph, nodes: [...nodes, ...newNodes], edges: [...graph.edges, ...edges] }
}
