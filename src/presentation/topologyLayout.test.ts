import { describe, expect, it } from 'vitest'
import { rawInventory } from '../__fixtures__'
import { topologyPayload } from '../__fixtures__/topology'
import { normalizeInventory } from '../domain/normalize'
import { buildTopologyGraph } from '../domain/topology'
import {
  CARD_BORDER,
  CARD_LINE_HEIGHT,
  CARD_PADDING_Y,
  CARD_WIDTH,
  JACK_BAND_HEIGHT,
  PALETTE_VIDS,
  cableWidth,
  cardLines,
  cardSize,
  fallbackVlanColor,
  jackBands,
  titleBadge,
  type CardLine,
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

  it('sizes switch cards by their jack rows, single-uplink ones like ordinary cards', () => {
    const sw = nodeOf('sw-core-01') // 1 NORTH + 5 SOUTH ports
    expect(cardSize(sw).width).toBe(330) // 5 * 42 + 40 = 250 < 330
    expect(cardSize({ ...sw, ports: Array(9).fill(sw.ports[1]) }).width).toBe(9 * 42 + 40)
    // At most one SOUTH port (an access point, a switch with one cable down): ordinary width.
    expect(cardSize({ ...sw, ports: sw.ports.slice(0, 2) }).width).toBe(CARD_WIDTH)
    expect(cardSize({ ...sw, ports: sw.ports.slice(0, 1) }).width).toBe(CARD_WIDTH)
    expect(cardSize(nodeOf('node-alpha')).width).toBe(CARD_WIDTH)
  })

  it('keeps the full state badge only on cards wide enough for it beside a long name', () => {
    expect(titleBadge(CARD_WIDTH)).toBe('dot')
    expect(titleBadge(cardSize(nodeOf('sw-core-01')).width)).toBe('full') // a jack-row switch, 330
    expect(titleBadge(294)).toBe('dot')
    expect(titleBadge(295)).toBe('full')
  })

  it('makes the card as tall as its rows, paddings, border and jack bands', () => {
    const rows = (lines: CardLine[]) => lines.reduce((n, l) => n + CARD_LINE_HEIGHT[l], 0)
    const frame = 2 * (CARD_BORDER + CARD_PADDING_Y)
    const alpha = nodeOf('node-alpha')
    expect(cardLines(alpha)).toEqual(['title', 'sub', 'ip', 'summary'])
    expect(cardLines({ ...alpha, hasMetrics: true })).toEqual(['title', 'sub', 'ip', 'summary', 'load'])
    expect(cardLines({ ...alpha, isMachine: false, hasMetrics: false, ip: null, model: null, roleSlug: null })).toEqual(['title'])
    for (const node of graph.nodes) {
      const bands = (jackBands(node).north ? JACK_BAND_HEIGHT : 0) + (jackBands(node).south ? JACK_BAND_HEIGHT : 0)
      expect(cardSize(node).height).toBe(frame + rows(cardLines(node)) + bands)
    }
    const sw = nodeOf('sw-core-01')
    expect(jackBands(sw)).toEqual({ north: true, south: true })
    expect(jackBands(nodeOf('gw-router-01'))).toEqual({ north: false, south: true })
    expect(jackBands(alpha)).toEqual({ north: false, south: false })
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
    expect(vlanColor(61)).toBe('var(--color-vlan-61)')
    expect(vlanColor(345)).toBe(fallbackVlanColor(345))
    expect(styleColor({ kind: 'trunk', vlan: null })).toBe('var(--color-cable-trunk)')
    expect(styleColor({ kind: 'access', vlan: 30 })).toBe('var(--color-vlan-30)')
    expect(styleColor({ kind: 'unknown', vlan: null })).toBe('var(--color-cable-unknown)')
  })

  it('derives a stable colour for an unlisted vid, different for every vid', () => {
    expect(fallbackVlanColor(345)).toBe(fallbackVlanColor(345))
    expect(fallbackVlanColor(345)).toMatch(/^oklch\(0\.\d+ 0\.13 \d+\.\d\d\)$/)
    const unlisted = Array.from({ length: 4094 }, (_, i) => i + 1).filter((v) => !PALETTE_VIDS.has(v))
    expect(new Set(unlisted.map(fallbackVlanColor)).size).toBe(unlisted.length)
    // Neighbouring vids land far apart on the hue wheel.
    const hue = (vid: number) => Number(fallbackVlanColor(vid).split(' ')[2].replace(')', ''))
    const gap = Math.abs(hue(201) - hue(202))
    expect(Math.min(gap, 360 - gap)).toBeGreaterThan(90)
  })

  it('fits to the width, never above 1 nor below 0.6', () => {
    expect(fitScale(1200, 1000)).toBe(1)
    expect(fitScale(800, 1000)).toBe(0.8)
    expect(fitScale(300, 1000)).toBe(0.6)
    expect(fitScale(0, 1000)).toBe(1)
  })
})
