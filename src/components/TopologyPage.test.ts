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

async function mountPage(extra: Record<string, unknown> = {}) {
  const wrapper = mount(TopologyPage, {
    props: { topology: { data: topologyPayload, devices, machineIds }, machines: new Map(), presence: new Map(), ...extra },
  })
  await vi.waitFor(() => expect(wrapper.findAll('.topo-card')).toHaveLength(7), { timeout: 4000 })
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

describe('TopologyPage Wi-Fi block and layers', () => {
  it('cross-highlights an access point between the diagram and its Wi-Fi column', async () => {
    localStorage.clear()
    const w = await mountPage({ wifi: wifiPayload })
    // Hovering the access point's card emphasises its column.
    await card(w, '2').trigger('pointerenter', { pointerType: 'mouse' })
    expect(w.findAll('.ap-head.is-traced').map((h) => h.text())).toEqual(['ap-east'])
    await card(w, '2').trigger('pointerleave')
    expect(w.findAll('.ap-head.is-traced')).toHaveLength(0)

    // Hovering a column header traces the card (and its cables) on the diagram.
    const west = w.findAll('.ap-head').find((h) => h.text() === 'ap-west')!
    await west.trigger('pointerenter', { pointerType: 'mouse' })
    expect(w.find('.topo-canvas').classes()).toContain('is-tracing')
    expect(tracedCards(w)).toEqual(['1', '14'])
    expect(tracedCables(w)).toEqual(['7'])
    await west.trigger('pointerleave')
    expect(w.find('.topo-canvas').classes()).not.toContain('is-tracing')

    // An access point without a NetBox device highlights only its column.
    const loft = w.findAll('.ap-head').find((h) => h.text() === 'ap-loft')!
    await loft.trigger('pointerenter', { pointerType: 'mouse' })
    expect(w.find('.topo-canvas').classes()).not.toContain('is-tracing')
    expect(w.findAll('.ap-head.is-traced').map((h) => h.text())).toEqual(['ap-loft'])
  })

  it('cycles the layers, keeps access points as anchors, and remembers the states', async () => {
    localStorage.clear()
    const w = await mountPage({ wifi: wifiPayload })
    const button = (id: string) => w.find(`.layer-btn[data-layer="${id}"]`)
    expect(w.find('.topo-canvas').classes()).toContain('layer-wired-shown')
    expect(w.find('.topo-wifi').exists()).toBe(true)
    expect(w.find('.topo-legend [data-legend="wifi"]').exists()).toBe(true)

    await button('wired').trigger('click')
    expect(w.find('.topo-canvas').classes()).toContain('layer-wired-grey')
    expect(card(w, '2').classes()).toContain('is-anchor') // an access point stays visible
    expect(card(w, '11').classes()).not.toContain('is-anchor')
    await button('wired').trigger('click')
    expect(w.find('.topo-canvas').classes()).toContain('layer-wired-hidden')
    await button('wired').trigger('click')
    expect(w.find('.topo-canvas').classes()).toContain('layer-wired-shown')

    await button('wifi').trigger('click')
    expect(w.find('.topo-wifi').classes()).toContain('layer-wifi-grey')
    await button('wifi').trigger('click')
    expect(w.find('.topo-wifi').exists()).toBe(false)
    expect(w.find('.topo-legend [data-legend="wifi"]').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem(LAYER_STORAGE_KEY)!)).toEqual({ wired: 'shown', wifi: 'hidden' })

    // A new page starts from the remembered states.
    const again = await mountPage({ wifi: wifiPayload })
    expect(again.find('.topo-wifi').exists()).toBe(false)
    localStorage.clear()
  })
})
