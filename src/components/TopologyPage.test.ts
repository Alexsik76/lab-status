import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { rawInventory } from '../__fixtures__'
import { topologyPayload } from '../__fixtures__/topology'
import { normalizeInventory } from '../domain/normalize'
import TopologyPage from './TopologyPage.vue'

const devices = normalizeInventory(rawInventory).devices
const machineIds = new Set(devices.filter((d) => d.roleSlug === 'server').map((d) => d.id))

async function mountPage() {
  const wrapper = mount(TopologyPage, {
    props: { topology: { data: topologyPayload, devices, machineIds }, machines: new Map(), presence: new Map() },
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
