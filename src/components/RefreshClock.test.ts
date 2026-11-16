import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceStatuses } from '../composables/useSourceStatuses'
import RefreshClock from './RefreshClock.vue'

const NOW = Date.parse('2026-11-17T01:00:00Z')
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

const polled = (seconds: number, periodS = 300, state: 'live' | 'error' = 'live', error: string | null = null) => ({
  state,
  error,
  updatedAt: ago(seconds),
  periodS,
})

const statuses = (inventoryAge: number, extra: SourceStatuses = {}): SourceStatuses => ({
  inventory: polled(inventoryAge),
  services: polled(40, 180),
  proxmox: polled(3, 15),
  metrics: polled(20, 60),
  containers: { ...polled(100), state: 'live' },
  arp: { state: 'live', error: null },
  ...extra,
})

const mountClock = (s: SourceStatuses, streamState = 'open') =>
  mount(RefreshClock, { props: { statuses: s, streamState: streamState as 'open' } })

const pattern = (wrapper: ReturnType<typeof mountClock>) =>
  wrapper.findAll('.bit').map((b) => (b.classes('lit') ? '1' : '0')).join('')
const bitColor = (wrapper: ReturnType<typeof mountClock>) =>
  (wrapper.find('.refresh-btn').element as HTMLElement).style.getPropertyValue('--bit-color')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => vi.useRealTimers())

describe('RefreshClock', () => {
  it('shows the inventory age in binary, most significant bit left', () => {
    expect(pattern(mountClock(statuses(0)))).toBe('000000000')
    expect(pattern(mountClock(statuses(5)))).toBe('000000101')
    expect(pattern(mountClock(statuses(300)))).toBe('100101100')
    expect(pattern(mountClock(statuses(600)))).toBe('111111111') // above 511: all lit
  })

  it('takes the bit count from the inventory period', () => {
    expect(mountClock(statuses(0)).findAll('.bit')).toHaveLength(9)
    const short = mountClock({ ...statuses(0), inventory: polled(3, 15) })
    expect(short.findAll('.bit')).toHaveLength(4)
    expect(pattern(short)).toBe('0011')
    expect(mountClock({}).findAll('.bit')).toHaveLength(9) // no status yet: the default period
  })

  it('colours the lit bits by the fraction of the period elapsed', () => {
    expect(bitColor(mountClock(statuses(0)))).toBe('rgb(52, 211, 84)')
    expect(bitColor(mountClock(statuses(150)))).toBe('rgb(245, 204, 30)')
    expect(bitColor(mountClock(statuses(300)))).toBe('rgb(240, 78, 38)')
    expect(bitColor(mountClock(statuses(420)))).toBe('rgb(240, 78, 38)')
  })

  it('turns orange-red when any source is in error, whatever the age', () => {
    const wrapper = mountClock(statuses(10, { proxmox: polled(30, 15, 'error', 'Proxmox is unreachable.') }))
    expect(bitColor(wrapper)).toBe('rgb(240, 78, 38)')
    expect(wrapper.find('.refresh-btn').classes()).toContain('has-error')
    // A partial failure (live with an error) is not a source in error.
    const partial = mountClock(statuses(0, { inventory: polled(0, 300, 'live', 'Nginx Proxy Manager is unreachable.') }))
    expect(bitColor(partial)).toBe('rgb(52, 211, 84)')
  })

  it('is a button that asks for a refresh, with an accessible label', async () => {
    const wrapper = mountClock(statuses(42))
    const button = wrapper.find('button.refresh-btn')
    expect(button.attributes('aria-label')).toBe('Refresh, data 42 s old')
    await button.trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
    expect(mountClock({}).find('button').attributes('aria-label')).toBe('Refresh, data age unknown')
  })

  it('lists every source in the tooltip', () => {
    const wrapper = mountClock(
      statuses(12, {
        proxmox: polled(75, 15, 'error', 'Proxmox is unreachable.'),
        containers: { ...polled(5), state: 'live', error: 'docker-2: Portainer is unreachable.' },
        arp: { state: 'connecting', error: null },
      }),
    )
    const tip = wrapper.find('[role="tooltip"]')
    expect(wrapper.find('button').attributes('aria-describedby')).toBe(tip.attributes('id'))
    expect(tip.findAll('.tip-line').map((l) => l.text())).toEqual([
      'NetBox inventory 12 s ago',
      'Service checks 40 s ago',
      'Proxmox 1 min 15 s ago · Proxmox is unreachable.',
      'Proxmox graphs 20 s ago',
      'Containers live · docker-2: Portainer is unreachable.',
      'ARP connecting',
    ])
    expect(mountClock({}).findAll('.tip-line').map((l) => l.text())[0]).toBe('NetBox inventory no data yet')
  })

  it('counts with real time once per second', async () => {
    const wrapper = mountClock(statuses(10))
    vi.advanceTimersByTime(3000)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('button').attributes('aria-label')).toBe('Refresh, data 13 s old')
    expect(pattern(wrapper)).toBe('000001101')
  })

  it('does not redraw while the stream is paused, and catches up when it resumes', async () => {
    const wrapper = mountClock(statuses(10), 'paused')
    vi.advanceTimersByTime(5000)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('button').attributes('aria-label')).toBe('Refresh, data 10 s old')
    expect(wrapper.findAll('.tip-line').at(-1)?.text()).toBe('ARP paused')
    await wrapper.setProps({ streamState: 'open' })
    expect(wrapper.find('button').attributes('aria-label')).toBe('Refresh, data 15 s old')
  })

  it('returns to zero when a new updatedAt arrives', async () => {
    const wrapper = mountClock(statuses(250))
    expect(pattern(wrapper)).not.toBe('000000000')
    await wrapper.setProps({ statuses: statuses(0) })
    expect(pattern(wrapper)).toBe('000000000')
  })

  it('is disabled and busy while a refresh is being sent', () => {
    const wrapper = mount(RefreshClock, { props: { statuses: statuses(1), streamState: 'open', refreshing: true } })
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
    expect(wrapper.find('button').attributes('aria-busy')).toBe('true')
  })
})
