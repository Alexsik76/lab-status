import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppHeader from './AppHeader.vue'

const props = {
  page: 'hosts' as const,
  counts: { machines: 6, guests: 8, stoppedGuests: 1, containers: 28 },
  refreshing: false,
  updatedAt: null,
  arpPhase: 'live' as const,
  arpDisconnected: 0,
}

describe('AppHeader', () => {
  it('shows the summary and links the three pages in order', () => {
    const wrapper = mount(AppHeader, { props })
    expect(wrapper.text()).toContain('6 machines · 8 guests (1 stopped) · 28 containers')
    const items = wrapper.findAll('.switch-item')
    expect(items.map((a) => a.attributes('href'))).toEqual(['#/', '#/topology', '#/arp'])
    expect(items.map((a) => a.text())).toEqual(['Hosts', 'Topology', 'ARP'])
    expect(wrapper.find('[aria-current="page"]').text()).toBe('Hosts')
  })

  it('moves the thumb to the current page', () => {
    for (const page of ['hosts', 'topology', 'arp'] as const) {
      const wrapper = mount(AppHeader, { props: { ...props, page } })
      expect(wrapper.find('.page-switch').classes()).toContain(`on-${page}`)
      expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(1)
    }
    expect(mount(AppHeader, { props: { ...props, page: 'topology' } }).find('[aria-current="page"]').text()).toBe('Topology')
  })

  it('shows the refresh block on Hosts and Topology, the live state on ARP', () => {
    const on = (page: 'hosts' | 'topology' | 'arp') => mount(AppHeader, { props: { ...props, page } })
    expect(on('hosts').find('.refresh-btn').exists()).toBe(true)
    expect(on('topology').find('.refresh-btn').exists()).toBe(true)
    expect(on('arp').find('.refresh-btn').exists()).toBe(false)
    expect(on('arp').find('.arp-live').text()).toBe('live')
  })

  it('counts disconnected ARP entries on the ARP tab, hidden when there are none', () => {
    expect(mount(AppHeader, { props }).find('.switch-badge').exists()).toBe(false)
    const badge = mount(AppHeader, { props: { ...props, arpDisconnected: 3 } }).find('.switch-badge')
    expect(badge.text()).toMatch(/^3/)
    expect(badge.find('[role="tooltip"]').text()).toBe('3 addresses do not answer: ARP status failed or incomplete')
  })

  it('has no "rendered" text: the time sits in the refresh block', () => {
    const wrapper = mount(AppHeader, { props: { ...props, updatedAt: new Date('2026-11-17T06:46:29Z') } })
    expect(wrapper.text()).not.toMatch(/rendered/i)
    expect(wrapper.find('.header-right .refresh-btn .updated-time').exists()).toBe(true)
  })
})
