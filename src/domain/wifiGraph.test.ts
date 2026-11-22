import { describe, expect, it } from 'vitest'
import { rawInventory } from '../__fixtures__'
import { topologyPayload } from '../__fixtures__/topology'
import { wifiPayload } from '../__fixtures__/wifi'
import { layoutKey } from '../presentation/topologyLayout'
import type { WifiData } from '../types/wifi'
import { normalizeInventory } from './normalize'
import { buildTopologyGraph } from './topology'
import {
  clientNodeId,
  clientPortId,
  frameEdgeId,
  frameNodeId,
  framePortId,
  mergePlan,
  planKey,
  radioKey,
  radioLabel,
  radioPortId,
  wifiEdgeId,
  wifiLive,
  withWifi,
} from './wifiGraph'

const devices = normalizeInventory(rawInventory).devices
const machineIds = new Set(devices.filter((d) => d.roleSlug === 'server').map((d) => d.id))
const wired = buildTopologyGraph(topologyPayload, devices, machineIds)
const WEST = '[02:AA:00:00:00:01]' // device 14
const EAST = '[02:AA:00:00:00:02]' // device 2

const build = (data: WifiData = wifiPayload) => {
  const { next } = mergePlan(null, data)
  return { plan: next, graph: withWifi(wired, next, wifiLive(next, data), machineIds) }
}

describe('Wi-Fi in the graph', () => {
  it('adds one radio port per AP x SSID after the copper ports, disabled / down ones dimmed', () => {
    const { graph } = build()
    const east = graph.nodes.find((n) => n.id === '2')!
    const radios = east.ports.filter((p) => p.kind === 'radio')
    expect(radios.map((p) => [p.label, p.side, p.off])).toEqual([
      ['Gadgets · 2462', 'SOUTH', false],
      ['Visitors · down', 'SOUTH', true],
    ])
    // After the copper ports, in network order.
    const copperMax = Math.max(...east.ports.filter((p) => p.kind !== 'radio').map((p) => p.order))
    expect(radios.every((p) => p.order > copperMax)).toBe(true)
    expect(east.ports.at(-1)!.kind).toBe('radio')
    const west = graph.nodes.find((n) => n.id === '14')!
    expect(west.ports.filter((p) => p.kind === 'radio').map((p) => p.label)).toEqual(['Gadgets · 2412', 'Home · 5180'])
    // The access point without a NetBox device (and its disabled radio) is not on the diagram.
    expect(graph.nodes.flatMap((n) => n.ports).some((p) => p.id.includes('02:AA:00:00:00:03'))).toBe(false)
  })

  it('labels a disabled radio "off"', () => {
    expect(radioLabel('Home', { channel: null, state: 'disabled' })).toBe('Home · off')
    expect(radioLabel('Home', { channel: 5180, state: 'down' })).toBe('Home · down')
    expect(radioLabel('Home', { channel: 5180, state: 'running' })).toBe('Home · 5180')
  })

  it('gives a client that is already on the diagram a NORTH radio port and its own line', () => {
    const { graph } = build()
    const alpha = graph.nodes.find((n) => n.id === '11')! // node-alpha: wired, also on Wi-Fi
    const wlan = alpha.ports.find((p) => p.kind === 'radio')!
    expect([wlan.id, wlan.label, wlan.side]).toEqual([clientPortId('02:BB:00:00:00:03'), 'wlan', 'NORTH'])
    expect(graph.nodes.some((n) => n.id === clientNodeId('02:BB:00:00:00:03'))).toBe(false)
    expect(graph.edges.find((e) => e.id === wifiEdgeId('02:BB:00:00:00:03'))).toMatchObject({ target: wlan.id, sourceDevice: '2' })
  })

  it('packs two or more Wi-Fi-only clients of one radio into a frame with one line', () => {
    const { graph } = build()
    const key = radioKey(WEST, 'Gadgets', '2.4')
    const frame = graph.nodes.find((n) => n.id === frameNodeId(key))!
    expect(frame).toMatchObject({ kind: 'wifi-group', label: 'Gadgets · 2412 · 2' })
    expect(frame.members!.map((m) => [m.name, m.kind, m.inFrame, m.ports.length])).toEqual([
      ['bulb-hall', 'wifi-client', true, 0], // sorted by name
      ['plug-kitchen', 'wifi-client', true, 0],
    ])
    expect(frame.members![1]).toMatchObject({ ip: '192.0.2.31', offline: false })
    expect(frame.ports.map((p) => [p.id, p.side, p.bare])).toEqual([[framePortId(key), 'NORTH', true]])
    // The members are not nodes of their own, and one line replaces their two.
    expect(graph.nodes.some((n) => n.kind === 'wifi-client')).toBe(false)
    const lines = graph.edges.filter((e) => e.medium === 'wifi')
    expect(lines.map((e) => e.id).sort()).toEqual([frameEdgeId(key), wifiEdgeId('02:BB:00:00:00:03')].sort())
    expect(lines.find((e) => e.id === frameEdgeId(key))).toMatchObject({
      source: radioPortId(key),
      target: framePortId(key),
      targetDevice: frameNodeId(key),
      style: { kind: 'access', vlan: 30 },
      speed: null,
    })
  })

  it('keeps a single Wi-Fi-only client as its own card with its own line', () => {
    const single = { ...wifiPayload, clients: wifiPayload.clients.filter((c) => c.name !== 'bulb-hall') }
    const { graph } = build(single)
    const plug = graph.nodes.find((n) => n.id === clientNodeId('02:BB:00:00:00:01'))!
    expect(plug).toMatchObject({ kind: 'wifi-client', name: 'plug-kitchen', ip: '192.0.2.31', isMachine: false, offline: false })
    expect(plug.ports.map((p) => [p.kind, p.side, p.label])).toEqual([['radio', 'NORTH', 'wlan']])
    expect(graph.nodes.some((n) => n.kind === 'wifi-group')).toBe(false)
    expect(graph.edges.find((e) => e.id === wifiEdgeId('02:BB:00:00:00:01'))).toMatchObject({ target: clientPortId('02:BB:00:00:00:01') })
  })

  it('never moves a wired device on Wi-Fi into a frame', () => {
    // node-alpha (wired) and one Wi-Fi-only client on the same radio: no frame of two.
    const data = { ...wifiPayload, clients: [...wifiPayload.clients, { ...wifiPayload.clients[2], mac: '02:BB:00:00:00:44', name: 'tablet', deviceId: null }] }
    const { graph } = build(data)
    expect(graph.nodes.some((n) => n.id === frameNodeId(radioKey(EAST, 'Gadgets', '2.4')))).toBe(false)
    expect(graph.nodes.find((n) => n.id === '11')!.ports.some((p) => p.label === 'wlan')).toBe(true)
    expect(graph.nodes.find((n) => n.id === clientNodeId('02:BB:00:00:00:44'))!.kind).toBe('wifi-client')
  })

  it('a Wi-Fi client of a Hosts machine links there', () => {
    const data = { ...wifiPayload, clients: [{ ...wifiPayload.clients[0], deviceId: '99', name: 'laptop' }] } // alone: own card
    const { graph } = build(data)
    const laptop = graph.nodes.find((n) => n.kind === 'wifi-client')!
    expect(laptop.isMachine).toBe(false)
    const withMachine = withWifi(wired, mergePlan(null, data).next, wifiLive(mergePlan(null, data).next, data), new Set(['99']))
    expect(withMachine.nodes.find((n) => n.kind === 'wifi-client')).toMatchObject({ isMachine: true, deviceId: '99' })
  })
})

describe('the plan: what reaches the layout', () => {
  it('keeps a disconnected client (dimmed, port off) without changing the layout input', () => {
    const first = build()
    const gone = { ...wifiPayload, clients: wifiPayload.clients.filter((c) => c.name !== 'plug-kitchen') }
    const { next, structural } = mergePlan(first.plan, gone)
    expect(structural).toBe(false)
    const graph = withWifi(wired, next, wifiLive(next, gone), machineIds)
    const frame = graph.nodes.find((n) => n.kind === 'wifi-group')!
    const plug = frame.members!.find((m) => m.name === 'plug-kitchen')!
    expect(plug.offline).toBe(true) // dimmed, in place
    expect(frame.offline).toBe(false) // bulb-hall is still there: the frame's line stays
    expect(frame.members).toHaveLength(2)
    expect(layoutKey(graph)).toBe(layoutKey(first.graph))
    // All members gone: the frame's line goes too (port off), still no relayout.
    const none = { ...wifiPayload, clients: wifiPayload.clients.filter((c) => c.apId !== WEST) }
    const empty = mergePlan(next, none)
    const g2 = withWifi(wired, empty.next, wifiLive(empty.next, none), machineIds)
    expect(empty.structural).toBe(false)
    expect(g2.nodes.find((n) => n.kind === 'wifi-group')!.ports[0].off).toBe(true)
    expect(layoutKey(g2)).toBe(layoutKey(first.graph))
  })

  it('a channel, signal or radio state change is not structural', () => {
    const first = build()
    const tuned = {
      ...wifiPayload,
      radios: wifiPayload.radios.map((r) => ({ ...r, channel: (r.channel ?? 0) + 20, state: r.state === 'down' ? ('running' as const) : r.state })),
      clients: wifiPayload.clients.map((c) => ({ ...c, signal: -90, name: `${c.name}-renamed`, ip: '192.0.2.99' })),
    }
    const { next, structural } = mergePlan(first.plan, tuned)
    expect(structural).toBe(false)
    expect(layoutKey(withWifi(wired, next, wifiLive(next, tuned), machineIds))).toBe(layoutKey(first.graph))
  })

  it('a client joining or leaving a frame changes the frame size: structural', () => {
    const { plan } = build()
    const third = { ...wifiPayload, clients: [...wifiPayload.clients, { ...wifiPayload.clients[0], mac: '02:BB:00:00:00:55', name: 'camera-door' }] }
    const merged = mergePlan(plan, third)
    expect(merged.structural).toBe(true)
    const g = withWifi(wired, merged.next, wifiLive(merged.next, third), machineIds)
    expect(g.nodes.find((n) => n.kind === 'wifi-group')!.members).toHaveLength(3)
    expect(layoutKey(g)).not.toBe(layoutKey(build().graph))
  })

  it('a new client, a client on another radio, or a new radio is structural', () => {
    const { plan } = build()
    const joined = { ...wifiPayload, clients: [...wifiPayload.clients, { ...wifiPayload.clients[0], mac: '02:BB:00:00:00:77', name: 'new' }] }
    expect(mergePlan(plan, joined).structural).toBe(true)
    const roamed = { ...wifiPayload, clients: wifiPayload.clients.map((c) => (c.name === 'bulb-hall' ? { ...c, apId: EAST } : c)) }
    expect(mergePlan(plan, roamed).structural).toBe(true)
    const moreRadios = { ...wifiPayload, radios: [...wifiPayload.radios, { apId: EAST, ssid: 'Home', band: '5' as const, channel: 5500, state: 'running' as const }] }
    expect(mergePlan(plan, moreRadios).structural).toBe(true)
    expect(planKey(null)).toBe('')
  })
})
