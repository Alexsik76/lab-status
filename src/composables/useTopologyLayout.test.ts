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

describe('layout with groups (ELK, hierarchical)', () => {
  const inside = (p: { x: number; y: number }, r: { x: number; y: number; width: number; height: number }, tol = 0.5) =>
    p.x >= r.x - tol && p.x <= r.x + r.width + tol && p.y >= r.y - tol && p.y <= r.y + r.height + tol

  it('returns members in absolute coordinates inside their group, and cables that end on them', async () => {
    const { groupDevices, groupTopology } = await import('../__fixtures__/topologyGroups')
    const g = buildTopologyGraph(groupTopology, groupDevices)
    const p = await layoutTopology(g)
    expect(p.groups.map((x) => x.group.id)).toEqual(['cameras:3', 'proxmox'])
    for (const placed of p.groups) {
      for (const id of placed.group.memberIds) {
        const card = p.nodes.get(id)!
        expect(inside({ x: card.x, y: card.y }, placed)).toBe(true)
        expect(inside({ x: card.x + card.width, y: card.y + card.height }, placed)).toBe(true)
      }
    }
    // Every cable to a member ends on the member's card, at its port.
    for (const edge of g.edges) {
      const route = p.edges.get(edge.id)!
      const end = route[route.length - 1]
      const card = p.nodes.get(edge.targetDevice)!
      expect(end.y).toBeCloseTo(card.y, 0)
      expect(end.x).toBeGreaterThanOrEqual(card.x - 0.5)
      expect(end.x).toBeLessThanOrEqual(card.x + card.width + 0.5)
      const port = card.ports.get(edge.target)!
      expect(end.x).toBeCloseTo(card.x + port.x, 0)
      const start = route[0]
      const upper = p.nodes.get(edge.sourceDevice)!
      expect(start.y).toBeCloseTo(upper.y + upper.height, 0)
    }
  })
})

describe('row alignment (no groups)', () => {
  it('puts all cards of one layer at the same height', async () => {
    const p = await layoutTopology(graph)
    const ys = new Map<number, Set<number>>()
    for (const node of graph.nodes) {
      const y = Math.round(p.nodes.get(node.id)!.y)
      ys.set(node.depth, (ys.get(node.depth) ?? new Set()).add(y))
    }
    for (const [, set] of ys) expect(set.size).toBe(1)
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
