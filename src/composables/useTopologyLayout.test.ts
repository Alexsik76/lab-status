import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import { rawInventory } from '../__fixtures__'
import { topologyPayload } from '../__fixtures__/topology'
import { normalizeInventory } from '../domain/normalize'
import { buildTopologyGraph, type TopologyGraph } from '../domain/topology'
import { layoutTopology, useTopologyLayout } from './useTopologyLayout'

const devices = normalizeInventory(rawInventory).devices
const graph = buildTopologyGraph(topologyPayload, devices, new Set(['10', '11', '12', '13', '14']))

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10))
}

describe('layoutTopology (ELK)', () => {
  it('places every card and routes every cable', async () => {
    const p = await layoutTopology(graph)
    expect(p.nodes.size).toBe(graph.nodes.length)
    expect(p.edges.size).toBe(graph.edges.length)
    expect(p.width).toBeGreaterThan(0)
    // The router sits above the switch, the switch above its servers.
    expect(p.nodes.get('1')!.y).toBeLessThan(p.nodes.get('2')!.y)
    expect(p.nodes.get('2')!.y).toBeLessThan(p.nodes.get('11')!.y)
  })

  it('puts the switch jacks left to right in NetBox order, on the bottom edge', async () => {
    const p = await layoutTopology(graph)
    const sw = p.nodes.get('2')!
    const xs = ['202', '203', '204', '205', '206'].map((id) => sw.ports.get(id)!.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    expect(sw.ports.get('202')!.y).toBeCloseTo(sw.height, 0)
    expect(sw.ports.get('201')!.y).toBeCloseTo(0, 0)
  })

  it('cables start at the upper card and end at the lower one', async () => {
    const p = await layoutTopology(graph)
    const route = p.edges.get('2')!
    const sw = p.nodes.get('2')!
    const host = p.nodes.get('11')!
    expect(route[0].y).toBeCloseTo(sw.y + sw.height, 0)
    expect(route[route.length - 1].y).toBeCloseTo(host.y, 0)
  })
})

describe('useTopologyLayout', () => {
  it('lays out again only when the structure changes', async () => {
    const scope = effectScope()
    const input = shallowRef<TopologyGraph | null>(graph)
    const state = scope.run(() => useTopologyLayout(input))!
    await until(() => state.phase.value === 'ready')
    const first = state.placement.value

    // Same structure (e.g. rebuilt from an inventory event with new states): nothing re-runs.
    input.value = buildTopologyGraph(structuredClone(topologyPayload), devices, new Set(['10', '11', '12', '13', '14']))
    await nextTick()
    expect(state.phase.value).toBe('ready')
    expect(state.placement.value).toBe(first)

    input.value = buildTopologyGraph({ ...topologyPayload, cables: topologyPayload.cables.slice(0, 3) }, devices)
    await nextTick()
    await until(() => state.placement.value !== first)
    expect(state.placement.value!.nodes.size).toBe(4)
    scope.stop()
  })
})
