import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { rawInventory } from '../__fixtures__'
import { topologyPayload } from '../__fixtures__/topology'
import type { Machine } from '../domain/model'
import { normalizeInventory } from '../domain/normalize'
import { buildTopologyGraph, type TopologyNode } from '../domain/topology'
import { CARD_BORDER, cardSize, type PlacedNode } from '../presentation/topologyLayout'
import TopologyCard from './TopologyCard.vue'

const devices = normalizeInventory(rawInventory).devices
const machineIds = new Set(devices.filter((d) => d.roleSlug === 'server').map((d) => d.id))
const graph = buildTopologyGraph(topologyPayload, devices, machineIds, new Set(['11']))
const nodeOf = (name: string) => graph.nodes.find((n) => n.name === name)!

const machine = (id: string, metrics: boolean): Machine => ({
  id,
  name: 'm',
  state: 'up',
  services: [],
  model: null,
  manufacturer: null,
  ip: null,
  platform: null,
  icon: null,
  cluster: null,
  tags: [],
  hardware: { cpuCores: null, memoryGb: null, storageGb: null },
  guests: [],
  apps: [],
  metrics: metrics
    ? { cpu: { currentPct: '3%', spark: null }, mem: { currentPct: '77%', spark: null }, nodeStatus: 'online' }
    : null,
})

const px = (value: string | undefined) => Number.parseFloat(value ?? '0')

/**
 * What the card actually stacks, from its own inline styles: border, body paddings and the
 * fixed-height rows. Every child of the body must be such a row, so a line added to the card
 * without a height (and without a line kind that `cardSize` counts) fails here.
 */
function renderedHeight(node: TopologyNode, props: { machine?: Machine | null; presence?: 'up' | 'down' | null }) {
  const size = cardSize(node)
  const placed: PlacedNode = { x: 0, y: 0, ...size, ports: new Map() }
  const wrapper = mount(TopologyCard, { props: { node, placed, ...props } })
  const body = wrapper.find('.card-body')
  const children = [...body.element.children] as HTMLElement[]
  for (const child of children) {
    expect(child.classList.contains('card-line')).toBe(true)
    expect(child.style.height).toMatch(/px$/)
  }
  const style = (body.element as HTMLElement).style
  const rows = children.reduce((sum, child) => sum + px(child.style.height), 0)
  return { wrapper, size, height: 2 * CARD_BORDER + px(style.paddingTop) + px(style.paddingBottom) + rows }
}

describe('TopologyCard height = the size given to ELK', () => {
  const cases: [string, TopologyNode, { machine?: Machine | null; presence?: 'up' | 'down' | null }, number][] = [
    ['machine with metrics', nodeOf('node-alpha'), { machine: machine('11', true) }, 5],
    ['machine without metrics', nodeOf('node-beta'), { machine: machine('12', false) }, 4],
    ['machine whose tree entry is not there yet', nodeOf('node-alpha'), { machine: null }, 5],
    ['offline machine', { ...nodeOf('node-gamma'), offline: true }, { machine: machine('13', false) }, 4],
    ['non-machine with a state', { ...nodeOf('node-beta'), isMachine: false, hasMetrics: false }, { presence: 'up' }, 3],
    ['non-machine without a state', { ...nodeOf('node-beta'), isMachine: false, hasMetrics: false }, {}, 3],
    ['bare device', { ...nodeOf('node-beta'), isMachine: false, hasMetrics: false, ip: null, model: null, roleSlug: null }, {}, 1],
    ['switch with jacks on both sides', nodeOf('sw-core-01'), { presence: 'down' }, 3],
    ['router with jacks below', nodeOf('gw-router-01'), {}, 3],
  ]

  it('counts radio ports (two-line labels) and a Wi-Fi client card in the height', async () => {
    const { wifiPayload } = await import('../__fixtures__/wifi')
    const { mergePlan, wifiLive, withWifi } = await import('../domain/wifiGraph')
    const plan = mergePlan(null, wifiPayload).next
    const g = withWifi(graph, plan, wifiLive(plan, wifiPayload), machineIds)
    const members = g.nodes.flatMap((n) => n.members ?? [])
    for (const id of ['2', '14', '11', 'wifi:02:BB:00:00:00:01']) {
      const node = g.nodes.find((n) => n.id === id) ?? members.find((m) => m.id === id)!
      const { wrapper, size, height } = renderedHeight(node, {})
      expect(height).toBe(size.height)
      if (node.kind === 'wifi-client') {
        expect(wrapper.findAll('.card-line').map((l) => l.classes()[1])).toEqual(['line-title', 'line-ip'])
        expect(wrapper.find('.wifi-glyph').exists()).toBe(true) // a frame member: glyph, no port
        expect(wrapper.find('.jack').exists()).toBe(false)
      }
    }
  })

  it.each(cases)('%s', (_name, node, props, rows) => {
    const { wrapper, size, height } = renderedHeight(node, props)
    expect(wrapper.findAll('.card-line')).toHaveLength(rows)
    expect(height).toBe(size.height)
  })

  it('shows the load line with the current values', () => {
    const { wrapper } = renderedHeight(nodeOf('node-alpha'), { machine: machine('11', true) })
    expect(wrapper.find('.line-load').text()).toBe('CPU 3% · MEM 77%')
    expect(wrapper.find('.line-summary').text()).toBe('0 guests · 0 containers')
    expect(wrapper.find('.line-title .state').attributes('data-state')).toBe('up')
  })

  it('shows the state as a dot on an ordinary card, the word as tooltip and screen-reader text', () => {
    const { wrapper } = renderedHeight(nodeOf('node-alpha'), { machine: machine('11', true) })
    const state = wrapper.find('.line-title .state')
    expect(state.classes()).toContain('variant-dot')
    expect(state.attributes('title')).toBe('online')
    expect(state.find('.sr-only').text()).toBe('online')
    expect(state.find('.status-text').exists()).toBe(false)
    expect(wrapper.find('.line-title').classes()).toContain('badge-dot')
    expect(wrapper.find('.card-name').attributes('title')).toBe('node-alpha')
  })

  it('keeps the full badge on a wide switch card', () => {
    const { wrapper } = renderedHeight(nodeOf('sw-core-01'), { presence: 'down' })
    const state = wrapper.find('.line-title .state')
    expect(state.classes()).toContain('variant-machine')
    expect(state.text()).toBe('unreachable')
    expect(wrapper.find('.line-title').classes()).toContain('badge-full')
  })
})
