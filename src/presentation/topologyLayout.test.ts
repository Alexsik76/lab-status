import { describe, expect, it } from 'vitest'
import { rawInventory } from '../__fixtures__'
import { topologyPayload } from '../__fixtures__/topology'
import { normalizeInventory } from '../domain/normalize'
import { buildTopologyGraph, type TopologyNode } from '../domain/topology'
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
  JACK_SIZE,
  JACK_LABEL_GAP,
  JACK_LABEL_HEIGHT,
  jackShape,
  type ElkGroupInput,
  type ElkNodeInput,
  FRAME_GAP,
  FRAME_PADDING,
  WIFI_CARD_WIDTH,
  packFrame,
} from './topologyLayout'

const devices = normalizeInventory(rawInventory).devices
const machines = new Set(devices.filter((d) => d.roleSlug === 'server').map((d) => d.id))
const graph = buildTopologyGraph(topologyPayload, devices, machines)
const nodeOf = (name: string) => graph.nodes.find((n) => n.name === name)!

describe('toElkGraph', () => {
  const elk = toElkGraph(graph)
  const child = (deviceId: string) => elk.children.find((c) => c.id === `d${deviceId}`) as ElkNodeInput

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

describe('Wi-Fi client frames', () => {
  const member = (name: string): TopologyNode => ({ ...nodeOf('node-alpha'), id: `m-${name}`, name, kind: 'wifi-client', inFrame: true, ports: [], isMachine: false, hasMetrics: false, model: null, roleSlug: null })
  const names = ['a', 'b', 'c', 'd', 'e']

  it('packs 1, 2, 3 and 5 members in at most two columns, row by row', () => {
    const cell = cardSize(member('x'))
    expect(cell).toEqual({ width: WIFI_CARD_WIDTH, height: 2 * (CARD_BORDER + CARD_PADDING_Y) + CARD_LINE_HEIGHT.title + CARD_LINE_HEIGHT.ip })
    const pack = (n: number) => packFrame(names.slice(0, n).map(member))
    const w1 = FRAME_PADDING.left + FRAME_PADDING.right + cell.width
    const w2 = w1 + FRAME_GAP + cell.width
    const h = (rows: number) => FRAME_PADDING.top + FRAME_PADDING.bottom + rows * cell.height + (rows - 1) * FRAME_GAP
    expect([pack(1).width, pack(1).height]).toEqual([w1, h(1)])
    expect([pack(2).width, pack(2).height]).toEqual([w2, h(1)])
    expect([pack(3).width, pack(3).height]).toEqual([w2, h(2)])
    expect([pack(5).width, pack(5).height]).toEqual([w2, h(3)])
    const slots = pack(5).slots
    expect(slots.map((s) => [s.x, s.y])).toEqual([
      [FRAME_PADDING.left, FRAME_PADDING.top],
      [FRAME_PADDING.left + cell.width + FRAME_GAP, FRAME_PADDING.top],
      [FRAME_PADDING.left, FRAME_PADDING.top + cell.height + FRAME_GAP],
      [FRAME_PADDING.left + cell.width + FRAME_GAP, FRAME_PADDING.top + cell.height + FRAME_GAP],
      [FRAME_PADDING.left, FRAME_PADDING.top + 2 * (cell.height + FRAME_GAP)],
    ])
  })

  it('keeps an access point with a few radio ports an ordinary card (the 330 minimum is for copper rows)', () => {
    const sw = nodeOf('sw-core-01')
    const radio = (i: number) => ({ ...sw.ports[1], id: `r${i}`, kind: 'radio' as const, side: 'SOUTH' as const })
    const ap = { ...sw, ports: [sw.ports[0], radio(1), radio(2), radio(3)] } // uplink + 3 radios
    expect(cardSize(ap).width).toBe(CARD_WIDTH) // 3 * 42 + 40 = 166 < 190
    const busy = { ...sw, ports: [sw.ports[0], ...[1, 2, 3, 4, 5].map(radio)] }
    expect(cardSize(busy).width).toBe(5 * 42 + 40)
    expect(cardSize(sw).width).toBe(330) // 5 copper ports: a jack row
  })

  it('gives ELK the frame as one node of the packed size, with a bare port on its top edge', () => {
    const frame: TopologyNode = {
      ...nodeOf('node-alpha'),
      id: 'wififrame:k',
      kind: 'wifi-group',
      members: names.slice(0, 3).map(member),
      ports: [{ ...nodeOf('node-alpha').ports[0], id: 'wififrame-port:k', side: 'NORTH', kind: 'radio', bare: true }],
    }
    const g = { ...graph, nodes: [...graph.nodes, frame] }
    const elk = toElkGraph(g).children.find((c) => c.id === 'dwififrame:k') as ElkNodeInput
    const packed = packFrame(frame.members!)
    expect([elk.width, elk.height]).toEqual([packed.width, packed.height])
    expect(elk.ports).toEqual([expect.objectContaining({ id: 'pwififrame-port:k', width: 0 })])
    expect('children' in elk).toBe(false) // ELK does not lay out the members
  })
})

describe('groups in the ELK input', () => {
  it('nests the members under one node per group, edges stay at the root', async () => {
    const { groupDevices, groupTopology } = await import('../__fixtures__/topologyGroups')
    const g = buildTopologyGraph(groupTopology, groupDevices)
    const elk = toElkGraph(g)
    expect(elk.layoutOptions['elk.hierarchyHandling']).toBe('INCLUDE_CHILDREN')
    const cams = elk.children.find((c) => c.id === 'gcameras:3') as ElkGroupInput
    expect(cams.children.map((c) => c.id)).toEqual(['d31', 'd32', 'd33'])
    expect(cams.layoutOptions['elk.padding']).toBe('[top=28,left=12,bottom=12,right=12]')
    const hv = elk.children.find((c) => c.id === 'gproxmox') as ElkGroupInput
    expect(hv.children.map((c) => c.id)).toEqual(['d41', 'd42'])
    const rootIds = elk.children.map((c) => c.id)
    for (const member of ['d31', 'd32', 'd33', 'd41', 'd42']) expect(rootIds).not.toContain(member)
    expect(elk.edges).toHaveLength(g.edges.length)
  })

  it('has no hierarchy option without groups, and a key that changes with membership', async () => {
    expect(toElkGraph(graph).layoutOptions['elk.hierarchyHandling']).toBeUndefined()
    const { groupDevices, groupTopology } = await import('../__fixtures__/topologyGroups')
    const g = buildTopologyGraph(groupTopology, groupDevices)
    expect(layoutKey({ ...g, groups: g.groups.slice(0, 1) })).not.toBe(layoutKey(g))
    const fewer = { ...g, groups: [{ ...g.groups[0], memberIds: g.groups[0].memberIds.slice(0, 2) }, ...g.groups.slice(1)] }
    expect(layoutKey(fewer)).not.toBe(layoutKey(g))
  })

  it('has no post-compaction (rows stay aligned)', () => {
    expect(toElkGraph(graph).layoutOptions['elk.layered.compaction.postCompaction.strategy']).toBeUndefined()
    expect(toElkGraph(graph).layoutOptions['elk.layered.nodePlacement.strategy']).toBe('BRANDES_KOEPF')
  })
})

describe('jacks', () => {
  it('picks the shape by interface type', () => {
    for (const t of ['1000base-t', '2.5gbase-t', '10gbase-t', '100base-tx']) expect(jackShape(t)).toBe('rj45')
    for (const t of ['1000base-x-sfp', '10gbase-x-sfpp', '25gbase-x-sfp28', '40gbase-x-qsfpp', '100gbase-x-qsfp28', '1000base-x-gbic'])
      expect(jackShape(t)).toBe('sfp')
    for (const t of ['virtual', 'ieee802.11ax', 'other', null]) expect(jackShape(t)).toBe('plain')
  })

  it('fits the port pitch and the jack band', () => {
    for (const s of Object.values(JACK_SIZE)) expect(s.width).toBeLessThanOrEqual(42 - 4)
    const tallest = Math.max(...Object.values(JACK_SIZE).map((s) => s.height))
    expect(JACK_BAND_HEIGHT).toBeGreaterThanOrEqual(tallest / 2 + JACK_LABEL_GAP + JACK_LABEL_HEIGHT)
  })

  it('gives ELK each port as wide as its jack', () => {
    const sw = toElkGraph(graph).children.find((c) => c.id === 'd2') as ElkNodeInput
    expect(sw.ports.find((p) => p.id === 'p201')!.width).toBe(JACK_SIZE.sfp.width)
    expect(sw.ports.find((p) => p.id === 'p202')!.width).toBe(JACK_SIZE.rj45.width)
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
