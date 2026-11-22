import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { rawInventory } from '../__fixtures__'
import { topologyPayload } from '../__fixtures__/topology'
import { normalizeInventory } from '../domain/normalize'
import TopologyPage from './TopologyPage.vue'
import { wifiPayload } from '../__fixtures__/wifi'
import { LAYER_STORAGE_KEY } from '../presentation/layers'

const devices = normalizeInventory(rawInventory).devices
const machineIds = new Set(devices.filter((d) => d.roleSlug === 'server').map((d) => d.id))

async function mountPage(extra: Record<string, unknown> = {}, cards = 7) {
  const wrapper = mount(TopologyPage, {
    props: { topology: { data: topologyPayload, devices, machineIds }, machines: new Map(), presence: new Map(), ...extra },
  })
  await vi.waitFor(() => expect(wrapper.findAll('.topo-card')).toHaveLength(cards), { timeout: 4000 })
  return wrapper
}

const card = (w: VueWrapper, id: string) => w.find(`.topo-card[data-focus-device="${id}"]`)
const tracedCards = (w: VueWrapper) => w.findAll('.topo-card.is-traced').map((c) => c.attributes('data-focus-device')).sort()
const tracedCables = (w: VueWrapper) => w.findAll('.cable.is-traced').map((c) => c.attributes('data-cable')).sort()

describe('TopologyPage hover trace', () => {
  it('traces the pointed device: its cables, neighbour cards, jacks and speed tags', async () => {
    const w = await mountPage()
    expect(w.find('.topo-canvas').classes()).not.toContain('is-tracing')

    await card(w, '10').trigger('pointerenter', { pointerType: 'mouse' }) // storage-nas: two cables to the switch
    expect(w.find('.topo-canvas').classes()).toContain('is-tracing')
    expect(w.find('.topo-cables').classes()).toContain('is-tracing')
    expect(tracedCables(w)).toEqual(['5', '6'])
    expect(tracedCards(w)).toEqual(['10', '2'])
    // The traced cables are drawn last (on top).
    expect(w.findAll('.cable').slice(-2).map((c) => c.attributes('data-cable')).sort()).toEqual(['5', '6'])
    // On the switch only the two jacks of those cables are traced.
    expect(card(w, '2').findAll('.jack.is-traced').map((j) => j.text()).sort()).toEqual(['port5', 'port6'])
    expect(card(w, '10').findAll('.entry.is-traced')).toHaveLength(2)

    await card(w, '10').trigger('pointerleave')
    expect(w.find('.topo-canvas').classes()).not.toContain('is-tracing')
    expect(tracedCables(w)).toEqual([])
    expect(tracedCards(w)).toEqual([])
  })

  it('keeps the speed tag of a traced cable, one hop only, and clears on mouseleave', async () => {
    const w = await mountPage()
    await card(w, '1').trigger('pointerenter', { pointerType: 'mouse' }) // the router
    expect(tracedCables(w)).toEqual(['1', '7'])
    expect(tracedCards(w)).toEqual(['1', '14', '2'])
    const tags = w.findAll('.speed-tag')
    expect(tags.filter((t) => t.classes().includes('is-traced')).map((t) => t.text()).sort()).toEqual(['100M', '10G'])
    expect(tags.find((t) => t.text() === '2.5G')!.classes()).not.toContain('is-traced')

    await card(w, '1').trigger('mouseleave')
    expect(w.find('.topo-canvas').classes()).not.toContain('is-tracing')
  })

  it('does not trace on touch', async () => {
    const w = await mountPage()
    await card(w, '11').trigger('pointerenter', { pointerType: 'touch' })
    expect(w.find('.topo-canvas').classes()).not.toContain('is-tracing')
    expect(w.findAll('.is-traced')).toHaveLength(0)
    await flushPromises()
  })
})

describe('TopologyPage Wi-Fi in the diagram', () => {
  // Fixture: ap-west = device 14, ap-east = device 2; node-alpha (11) is wired and on Wi-Fi;
  // plug-kitchen and bulb-hall get cards of their own: 7 wired + 2 Wi-Fi cards.
  const node = (w: VueWrapper, id: string) => w.find(`.topo-card[data-node="${id}"]`)

  it('draws Wi-Fi clients as cards and Wi-Fi lines as wavy paths from radio ports', async () => {
    localStorage.clear()
    const w = await mountPage({ wifi: wifiPayload }, 9)
    expect(w.findAll('.topo-card.kind-wifi-client').map((c) => c.find('.card-name').text()).sort()).toEqual(['bulb-hall', 'plug-kitchen'])
    expect(node(w, '14').findAll('.jack.shape-radio').map((j) => j.attributes('title'))).toEqual(['Gadgets · 2412', 'Home · 5180'])
    expect(node(w, '2').find('.jack.shape-radio.is-off').attributes('title')).toBe('Visitors · down')
    expect(node(w, '11').find('.jack.shape-radio').attributes('title')).toBe('wlan')
    const wifiLines = w.findAll('.cable.medium-wifi')
    expect(wifiLines).toHaveLength(3)
    expect(wifiLines[0].find('path').attributes('d')).toContain('Q') // wavy
    expect(w.find('.topo-legend [data-legend="wifi"] path').exists()).toBe(true)
    expect(w.find('.topo-legend [data-legend="radio"] .jack-svg').exists()).toBe(true)
  })

  it('traces Wi-Fi lines like cables: an AP emphasises its clients, a client its AP', async () => {
    localStorage.clear()
    const w = await mountPage({ wifi: wifiPayload }, 9)
    await node(w, '14').trigger('pointerenter', { pointerType: 'mouse' })
    expect(tracedCables(w)).toEqual(['7', 'wifi:02:BB:00:00:00:01', 'wifi:02:BB:00:00:00:02'])
    expect(w.findAll('.topo-card.is-traced').map((c) => c.attributes('data-node')).sort()).toEqual(
      ['1', '14', 'wifi:02:BB:00:00:00:01', 'wifi:02:BB:00:00:00:02'],
    )
    await node(w, '14').trigger('pointerleave')
    await node(w, 'wifi:02:BB:00:00:00:02').trigger('pointerenter', { pointerType: 'mouse' })
    expect(w.findAll('.topo-card.is-traced').map((c) => c.attributes('data-node')).sort()).toEqual(['14', 'wifi:02:BB:00:00:00:02'])
  })

  it('keeps a disconnected client in place, dimmed, its line removed', async () => {
    localStorage.clear()
    const w = await mountPage({ wifi: wifiPayload }, 9)
    const before = node(w, 'wifi:02:BB:00:00:00:01').attributes('style')
    await w.setProps({ wifi: { ...wifiPayload, clients: wifiPayload.clients.slice(1) } })
    const plug = node(w, 'wifi:02:BB:00:00:00:01')
    expect(plug.classes()).toContain('is-offline')
    expect(plug.attributes('style')).toBe(before) // no relayout
    expect(w.find('.cable[data-cable="wifi:02:BB:00:00:00:01"]').exists()).toBe(false)
    expect(w.findAll('.cable.medium-wifi')).toHaveLength(2)
  })

  it('applies the layers: Wi-Fi grey and hidden, Wired grey keeps the Wi-Fi side visible', async () => {
    localStorage.clear()
    const w = await mountPage({ wifi: wifiPayload }, 9)
    const button = (id: string) => w.find(`.layer-btn[data-layer="${id}"]`)
    const canvas = () => w.find('.topo-canvas')

    await button('wired').trigger('click')
    expect(canvas().classes()).toContain('layer-wired-grey')
    const anchors = w.findAll('.topo-card.is-anchor').map((c) => c.attributes('data-node')).sort()
    expect(anchors).toEqual(['11', '14', '2', 'wifi:02:BB:00:00:00:01', 'wifi:02:BB:00:00:00:02'])
    expect(node(w, '12').classes()).not.toContain('is-anchor') // a wired-only server fades
    await button('wired').trigger('click')
    await button('wired').trigger('click') // back to shown

    await button('wifi').trigger('click')
    expect(canvas().classes()).toContain('layer-wifi-grey')
    expect(w.findAll('.topo-card')).toHaveLength(9)
    await button('wifi').trigger('click') // hidden: out of the layout
    await vi.waitFor(() => expect(w.findAll('.topo-card')).toHaveLength(7), { timeout: 4000 })
    expect(w.find('.jack.shape-radio').exists()).toBe(false)
    expect(w.find('.cable.medium-wifi').exists()).toBe(false)
    expect(w.find('.topo-legend [data-legend="wifi"]').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem(LAYER_STORAGE_KEY)!)).toEqual({ wired: 'shown', wifi: 'hidden' })
    // A new page starts from the remembered states.
    await mountPage({ wifi: wifiPayload }, 7)
    localStorage.clear()
  })
})
