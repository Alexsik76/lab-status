import { describe, expect, it } from 'vitest'
import { rawInventory } from '../__fixtures__'
import { topologyPayload } from '../__fixtures__/topology'
import { normalizeInventory } from '../domain/normalize'
import { buildTopologyGraph } from '../domain/topology'
import {
  cableWidth,
  cardSize,
  fitScale,
  layoutKey,
  roundedPath,
  speedTag,
  styleColor,
  toElkGraph,
  trunkWidths,
  vlanColor,
} from './topologyLayout'

const devices = normalizeInventory(rawInventory).devices
const machines = new Set(devices.filter((d) => d.roleSlug === 'server').map((d) => d.id))
const graph = buildTopologyGraph(topologyPayload, devices, machines)
const nodeOf = (name: string) => graph.nodes.find((n) => n.name === name)!

describe('toElkGraph', () => {
  const elk = toElkGraph(graph)
  const child = (deviceId: string) => elk.children.find((c) => c.id === `d${deviceId}`)!

  it('fixes the port order of switch-like devices, SOUTH ports indexed from the right', () => {
    const sw = child('2')
    expect(sw.layoutOptions['elk.portConstraints']).toBe('FIXED_ORDER')
    expect(sw.ports.map((p) => [p.id, p.layoutOptions['elk.port.side'], p.layoutOptions['elk.port.index']])).toEqual([
      ['p201', 'NORTH', '0'],
      ['p202', 'SOUTH', '5'],
      ['p203', 'SOUTH', '4'],
      ['p204', 'SOUTH', '3'],
      ['p205', 'SOUTH', '2'],
      ['p206', 'SOUTH', '1'],
    ])
  })

  it('fixes only the side for other devices', () => {
    const nas = child('10')
    expect(nas.layoutOptions['elk.portConstraints']).toBe('FIXED_SIDE')
    expect(nas.ports.every((p) => p.layoutOptions['elk.port.side'] === 'NORTH' && !('elk.port.index' in p.layoutOptions))).toBe(true)
  })

  it('connects ports, shallower to deeper', () => {
    expect(elk.edges).toContainEqual({ id: 'c1', sources: ['p101'], targets: ['p201'] })
    expect(elk.layoutOptions['elk.algorithm']).toBe('layered')
    expect(elk.layoutOptions['elk.direction']).toBe('DOWN')
  })

  it('sizes switch cards by their ports, others by content', () => {
    expect(cardSize(nodeOf('sw-core-01')).width).toBe(330) // 5 * 54 + 40 = 310 < 330
    expect(cardSize({ ...nodeOf('sw-core-01'), ports: Array(8).fill(nodeOf('sw-core-01').ports[1]) }).width).toBe(8 * 54 + 40)
    expect(cardSize(nodeOf('node-alpha')).height).toBeGreaterThan(cardSize({ ...nodeOf('node-alpha'), isMachine: false }).height)
  })

  it('has a key that ignores everything but the structure', () => {
    const same = buildTopologyGraph(structuredClone(topologyPayload), devices, machines)
    expect(layoutKey(same)).toBe(layoutKey(graph))
    const fewer = buildTopologyGraph({ ...topologyPayload, cables: topologyPayload.cables.slice(1) }, devices, machines)
    expect(layoutKey(fewer)).not.toBe(layoutKey(graph))
  })
})

describe('drawing helpers', () => {
  it('rounds the corners of an orthogonal route', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 50 }])).toBe('M0,0 L0,50')
    expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 40, y: 50 }])).toBe('M0,0 L0,41 Q0,50 9,50 L40,50')
    // A short segment clamps the radius to half its length.
    expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 40, y: 6 }])).toBe('M0,0 L0,3 Q0,6 3,6 L40,6')
    expect(roundedPath([])).toBe('')
  })

  it('maps speed to width and tag', () => {
    expect([cableWidth('10G'), cableWidth('2.5G'), cableWidth('1G'), cableWidth('100M'), cableWidth(null)]).toEqual([8, 4, 2.4, 1.4, 2.4])
    expect([speedTag('10G'), speedTag('1G'), speedTag('100M'), speedTag(null)]).toEqual(['10G', null, '100M', null])
  })

  it('draws a trunk wider than its speed width, with a visible core', () => {
    expect(trunkWidths('1G')).toEqual({ outer: 4, core: 1.6 })
    expect(trunkWidths('10G')).toEqual({ outer: 9.6, core: 4.4 })
  })

  it('colours by VLAN token with a fallback', () => {
    expect(vlanColor(20)).toBe('var(--color-vlan-20)')
    expect(vlanColor(345)).toBe('var(--color-vlan-other)')
    expect(styleColor({ kind: 'trunk', vlan: null })).toBe('var(--color-cable-trunk)')
    expect(styleColor({ kind: 'access', vlan: 30 })).toBe('var(--color-vlan-30)')
    expect(styleColor({ kind: 'unknown', vlan: null })).toBe('var(--color-cable-unknown)')
  })

  it('fits to the width, never above 1 nor below 0.6', () => {
    expect(fitScale(1200, 1000)).toBe(1)
    expect(fitScale(800, 1000)).toBe(0.8)
    expect(fitScale(300, 1000)).toBe(0.6)
    expect(fitScale(0, 1000)).toBe(1)
  })
})
