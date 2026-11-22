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
  // plug-kitchen and bulb-hall share ap-west's Gadgets radio: one frame of two members.
  const node = (w: VueWrapper, id: string) => w.find(`.topo-card[data-node="${id}"]`)
  const FRAME = 'wififrame:[02:AA:00:00:00:01]|Gadgets|2.4'

  it('draws radio ports, a frame of Wi-Fi clients with one wavy line, and the wired device on Wi-Fi', async () => {
    localStorage.clear()
    const w = await mountPage({ wifi: wifiPayload }, 9)
    expect(w.findAll('.topo-card.kind-wifi-client').map((c) => c.find('.card-name').text())).toEqual(['bulb-hall', 'plug-kitchen'])
    expect(w.findAll('.topo-card.kind-wifi-client .jack')).toHaveLength(0)
    expect(w.find(`.wifi-frame[data-frame="${FRAME}"]`).exists()).toBe(true)
    expect(w.find(`.wifi-frame-label[data-frame="${FRAME}"]`).text()).toBe('Gadgets · 2412 · 2')
    expect(node(w, '14').findAll('.jack.shape-radio').map((j) => j.attributes('title'))).toEqual(['Gadgets · 2412', 'Home · 5180'])
    expect(node(w, '2').find('.jack.shape-radio.is-off').attributes('title')).toBe('Visitors · down')
    expect(node(w, '11').find('.jack.shape-radio').attributes('title')).toBe('wlan')
    const wifiLines = w.findAll('.cable.medium-wifi')
    expect(wifiLines.map((l) => l.attributes('data-cable')).sort()).toEqual([FRAME, 'wifi:02:BB:00:00:00:03'].sort())
    expect(wifiLines[0].find('path').attributes('d')).toContain('Q') // wavy
    expect(w.find('.topo-legend [data-legend="wifi"] path').exists()).toBe(true)
    expect(w.find('.topo-legend [data-legend="radio"] .jack-svg').exists()).toBe(true)
  })

  it('traces through a frame: the AP lights the frame and its members, a member lights its AP and the line', async () => {
    localStorage.clear()
    const w = await mountPage({ wifi: wifiPayload }, 9)
    await node(w, '14').trigger('pointerenter', { pointerType: 'mouse' })
    expect(tracedCables(w)).toEqual(['7', FRAME])
    expect(w.findAll('.topo-card.is-traced').map((c) => c.attributes('data-node')).sort()).toEqual(
      ['1', '14', 'wifi:02:BB:00:00:00:01', 'wifi:02:BB:00:00:00:02'],
    )
    expect(w.find(`.wifi-frame[data-frame="${FRAME}"]`).classes()).toContain('is-traced')
    await node(w, '14').trigger('pointerleave')

    await node(w, 'wifi:02:BB:00:00:00:02').trigger('pointerenter', { pointerType: 'mouse' })
    expect(tracedCables(w)).toEqual([FRAME])
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
    expect(w.findAll('.cable.medium-wifi')).toHaveLength(2) // the frame's line stays for bulb-hall
    // node-alpha leaves: its own line goes.
    await w.setProps({ wifi: { ...wifiPayload, clients: wifiPayload.clients.slice(0, 2) } })
    expect(w.find('.cable[data-cable="wifi:02:BB:00:00:00:03"]').exists()).toBe(false)
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
    expect(w.find('.wifi-frame').exists()).toBe(true)
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
    expect(w.find('.wifi-frame').exists()).toBe(false)
    expect(w.find('.topo-legend [data-legend="wifi"]').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem(LAYER_STORAGE_KEY)!)).toEqual({ wired: 'shown', wifi: 'hidden', zigbee: 'shown' })
    // A new page starts from the remembered states.
    await mountPage({ wifi: wifiPayload }, 7)
    localStorage.clear()
  })
})

describe('TopologyPage Zigbee layer', () => {
  const node = (w: VueWrapper, id: string) => w.find(`.topo-card[data-node="${id}"]`)

  it('draws the coordinator port, the device frame and a bead line; traces both ways', async () => {
    localStorage.clear()
    const { zigbeePayload } = await import('../__fixtures__/zigbee')
    const w = await mountPage({ zigbee: zigbeePayload }, 10) // 7 wired + 3 Zigbee devices
    const port = node(w, '13').find('.jack.shape-zigbee')
    expect(port.attributes('title')).toBe('Zigbee')
    expect(port.find('polygon').exists()).toBe(true) // hexagon
    expect(w.findAll('.topo-card.kind-zigbee-device').map((c) => c.find('.card-name').text())).toEqual(['Attic plug', 'Hall button', 'Porch motion'])
    expect(w.findAll('.topo-card.kind-zigbee-device').map((c) => c.find('.line-sub').text())).toEqual(['PLUG-2', 'Hall', 'Porch'])
    expect(node(w, 'zigbee:z1').classes()).toContain('is-offline')
    expect(node(w, 'zigbee:z1').element.tagName).toBe('DIV') // not a link
    const label = w.find('.wifi-frame-label.frame-zigbee-group')
    expect(label.text()).toBe('Zigbee · 3')
    expect(label.attributes('title')).toContain('mesh routes are not shown')
    const beads = w.find('.cable.medium-zigbee path')
    expect(beads.attributes('stroke-dasharray')).toBe('0.01 8')
    expect(beads.attributes('stroke-width')).toBe('3.4')
    expect(w.find('.topo-legend [data-legend="zigbee"]').exists()).toBe(true)
    expect(w.find('.topo-legend [data-legend="zigbee-port"] polygon').exists()).toBe(true)

    await node(w, '13').trigger('pointerenter', { pointerType: 'mouse' })
    expect(tracedCables(w)).toContain('zigbee:line')
    expect(w.findAll('.topo-card.kind-zigbee-device.is-traced')).toHaveLength(3)
    expect(w.find('.wifi-frame.frame-zigbee-group').classes()).toContain('is-traced')
    await node(w, '13').trigger('pointerleave')
    await node(w, 'zigbee:z2').trigger('pointerenter', { pointerType: 'mouse' })
    expect(w.findAll('.topo-card.is-traced').map((c) => c.attributes('data-node')).sort()).toEqual(['13', 'zigbee:z2'])
    expect(tracedCables(w)).toEqual(['zigbee:line'])
  })

  it('greys and hides the Zigbee layer', async () => {
    localStorage.clear()
    const { zigbeePayload } = await import('../__fixtures__/zigbee')
    const w = await mountPage({ zigbee: zigbeePayload }, 10)
    const button = w.find('.layer-btn[data-layer="zigbee"]')
    await button.trigger('click')
    expect(w.find('.topo-canvas').classes()).toContain('layer-zigbee-grey')
    await button.trigger('click')
    await vi.waitFor(() => expect(w.findAll('.topo-card')).toHaveLength(7), { timeout: 4000 })
    expect(w.find('.jack.shape-zigbee').exists()).toBe(false)
    expect(w.find('.cable.medium-zigbee').exists()).toBe(false)
    expect(w.find('.frame-zigbee-group').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem(LAYER_STORAGE_KEY)!).zigbee).toBe('hidden')
    localStorage.clear()
  })
})

describe('TopologyPage camera on Wi-Fi', () => {
  it('sits in the Cameras frame; the label count and VLAN follow, and it leaves with the Wi-Fi layer', async () => {
    localStorage.clear()
    const { groupDevices, groupTopology, device } = await import('../__fixtures__/topologyGroups')
    const cams = [...groupDevices, device('39', 'cam-wireless', 'camera')]
    const wifi = {
      networks: [{ ssid: 'Lenses', band: '2.4' as const, vlan: 40 }],
      aps: [{ id: 'cap-a', name: 'core', deviceId: '2' }],
      radios: [{ apId: 'cap-a', ssid: 'Lenses', band: '2.4' as const, channel: 2437, state: 'running' as const }],
      clients: [{ apId: 'cap-a', ssid: 'Lenses', band: '2.4' as const, mac: '02:CC:00:00:00:39', name: 'cam-wireless', deviceId: '39', ip: null, signal: null, uptime: null }],
    }
    const w = mount(TopologyPage, {
      props: { topology: { data: groupTopology, devices: cams, machineIds: new Set<string>() }, machines: new Map(), presence: new Map(), wifi },
    })
    const label = () => w.find('.group-label[data-group="cameras:3"]').text()
    await vi.waitFor(() => expect(w.find('.topo-card[data-node="39"]').exists()).toBe(true), { timeout: 4000 })
    expect(label()).toBe('Cameras · 4 · VLAN 40 cams')
    expect(w.find('.topo-card[data-node="39"] .jack.shape-radio').exists()).toBe(true)
    expect(w.find('.topo-card[data-node="39"] .jack-name').exists()).toBe(false) // compact port
    expect(w.find('.cable.medium-wifi').exists()).toBe(true)

    const button = w.find('.layer-btn[data-layer="wifi"]')
    await button.trigger('click')
    await button.trigger('click') // hidden
    await vi.waitFor(() => expect(label()).toBe('Cameras · 3 · VLAN 40 cams'), { timeout: 4000 })
    expect(w.find('.topo-card[data-node="39"]').exists()).toBe(false)
    localStorage.clear()
  })
})
