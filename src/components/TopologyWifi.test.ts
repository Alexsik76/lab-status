import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { WIFI_GRID_OPEN_KEY } from '../presentation/layers'
import { wifiPayload } from '../__fixtures__/wifi'
import type { Machine } from '../domain/model'
import { buildWifiGrid } from '../domain/wifi'
import TopologyWifi from './TopologyWifi.vue'

const grid = buildWifiGrid(wifiPayload, (id) => ({ '2': 100, '14': 400 })[id])
const vlans = [{ vid: 30, name: 'gadgets' }, { vid: 20, name: 'home' }]
const machines = new Map([['11', { id: '11' } as Machine]])
const base = { grid, vlans, machines, error: null }

describe('TopologyWifi', () => {
  beforeEach(() => localStorage.setItem(WIFI_GRID_OPEN_KEY, '1'))

  it('draws access points as columns and networks as rows', () => {
    const w = mount(TopologyWifi, { props: base })
    expect(w.findAll('.ap-head').map((h) => h.text())).toEqual(['ap-east', 'ap-west', 'ap-loft'])
    expect(w.findAll('.row-head').map((h) => `${h.find('.ssid').text()} ${h.find('.row-meta').text()}`)).toEqual([
      'Gadgets 2.4 GHz · VLAN 30 gadgets',
      'Home 5 GHz · VLAN 20 home',
      'Visitors 2.4 GHz · no VLAN',
    ])
    const rowColor = w.findAll('.row-head')[0].attributes('style')
    expect(rowColor).toContain('--row-color: var(--color-vlan-30)')
  })

  it('fills the cells: nothing, radio disabled, channel with chips, no clients, radio down', () => {
    const w = mount(TopologyWifi, { props: base })
    const cells = w.findAll('.cell')
    // Row Gadgets: east, west, loft.
    expect(cells[0].find('.channel').text()).toBe('2462 MHz')
    expect(cells[0].findAll('.chip').map((c) => c.text())).toEqual(['node-alpha'])
    expect(cells[1].findAll('.chip').map((c) => c.text())).toEqual(['bulb-hall', 'plug-kitchen'])
    expect(cells[2].text()).toBe('radio disabled')
    // Row Home: nothing on east, no clients on west.
    expect(cells[3].text()).toBe('')
    expect(cells[4].text()).toContain('5180 MHz')
    expect(cells[4].find('.no-clients').text()).toBe('no clients')
    // Row Visitors on east: the radio is down.
    expect(cells[6].find('.radio-state').text()).toBe('down')
  })

  it('gives chips a tooltip and links a Hosts machine to its tile', () => {
    const w = mount(TopologyWifi, { props: base })
    const alpha = w.find('.chip[data-mac="02:BB:00:00:00:03"]')
    expect(alpha.element.tagName).toBe('A')
    expect(alpha.attributes('href')).toBe('#/?focus=11')
    expect(alpha.attributes('title')).toBe('02:BB:00:00:00:03 · 192.0.2.11 · -49 dBm · up 5h')
    expect(w.find('.chip[data-mac="02:BB:00:00:00:01"]').element.tagName).toBe('SPAN')
  })

  it('shows the empty and unavailable states', () => {
    expect(mount(TopologyWifi, { props: { ...base, grid: null } }).find('.empty-state').text()).toBe('Reading the wireless networks…')
    const failed = mount(TopologyWifi, { props: { ...base, grid: buildWifiGrid({ networks: [], aps: [], radios: [], clients: [] }), error: 'Wi-Fi: no such command prefix' } })
    expect(failed.find('.empty-state').text()).toBe('Wi-Fi data is unavailable. Wi-Fi: no such command prefix')
    const empty = mount(TopologyWifi, { props: { ...base, grid: buildWifiGrid({ networks: [], aps: [], radios: [], clients: [] }) } })
    expect(empty.find('.empty-state').text()).toBe('The router reports no wireless networks.')
  })

  it('is collapsed by default behind its title, opens on click and remembers it', async () => {
    localStorage.removeItem(WIFI_GRID_OPEN_KEY)
    const w = mount(TopologyWifi, { props: base })
    const toggle = w.find('.wifi-toggle')
    expect(toggle.text()).toContain('Wi-Fi')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(w.find('.wifi-grid').exists()).toBe(false)
    await toggle.trigger('click')
    expect(w.find('.wifi-grid').exists()).toBe(true)
    expect(localStorage.getItem(WIFI_GRID_OPEN_KEY)).toBe('1')
    await toggle.trigger('click')
    expect(w.find('.wifi-grid').exists()).toBe(false)
    expect(localStorage.getItem(WIFI_GRID_OPEN_KEY)).toBe('0')
  })
})
