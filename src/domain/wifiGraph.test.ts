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

  it('gives a client that is already on the diagram a NORTH radio port, others a card of their own', () => {
    const { graph } = build()
    const alpha = graph.nodes.find((n) => n.id === '11')! // node-alpha: wired, also on Wi-Fi
    const wlan = alpha.ports.find((p) => p.kind === 'radio')!
    expect([wlan.id, wlan.label, wlan.side]).toEqual([clientPortId('02:BB:00:00:00:03'), 'wlan', 'NORTH'])
    expect(graph.nodes.some((n) => n.id === clientNodeId('02:BB:00:00:00:03'))).toBe(false)

    const plug = graph.nodes.find((n) => n.id === clientNodeId('02:BB:00:00:00:01'))!
    expect(plug).toMatchObject({ kind: 'wifi-client', name: 'plug-kitchen', ip: '192.0.2.31', isMachine: false, offline: false })
    expect(plug.ports.map((p) => [p.kind, p.side, p.label])).toEqual([['radio', 'NORTH', 'wlan']])
    expect(graph.nodes.filter((n) => n.kind === 'wifi-client')).toHaveLength(2)
  })

  it('links each client from its radio port, coloured by the network VLAN, without speed', () => {
    const { graph } = build()
    const wifi = graph.edges.filter((e) => e.medium === 'wifi')
    expect(wifi).toHaveLength(3)
    const plug = wifi.find((e) => e.id === wifiEdgeId('02:BB:00:00:00:01'))!
    expect(plug).toMatchObject({
      source: radioPortId(radioKey(WEST, 'Gadgets', '2.4')),
      target: clientPortId('02:BB:00:00:00:01'),
      sourceDevice: '14',
      style: { kind: 'access', vlan: 30 },
      speed: null,
    })
    expect(wifi.find((e) => e.id === wifiEdgeId('02:BB:00:00:00:03'))!.sourceDevice).toBe('2')
  })

  it('a Wi-Fi client of a Hosts machine links there', () => {
    const data = { ...wifiPayload, clients: [{ ...wifiPayload.clients[0], deviceId: '99', name: 'laptop' }] }
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
    const plug = graph.nodes.find((n) => n.id === clientNodeId('02:BB:00:00:00:01'))!
    expect(plug.offline).toBe(true)
    expect(plug.ports[0].off).toBe(true)
    expect(layoutKey(graph)).toBe(layoutKey(first.graph))
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
