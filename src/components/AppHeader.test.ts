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
  it('shows the summary and links both pages', () => {
    const wrapper = mount(AppHeader, { props })
    expect(wrapper.text()).toContain('6 machines · 8 guests (1 stopped) · 28 containers')
    expect(wrapper.findAll('.switch-item').map((a) => a.attributes('href'))).toEqual(['#/', '#/arp'])
    expect(wrapper.find('[aria-current="page"]').text()).toBe('Hosts')
  })

  it('counts disconnected ARP entries on the ARP tab, hidden when there are none', () => {
    expect(mount(AppHeader, { props }).find('.switch-badge').exists()).toBe(false)
    const badge = mount(AppHeader, { props: { ...props, arpDisconnected: 3 } }).find('.switch-badge')
    expect(badge.text()).toBe('3')
  })
})
