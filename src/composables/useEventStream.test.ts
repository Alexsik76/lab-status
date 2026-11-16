import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArpRow } from '../types/arp'
import { useArp } from './useArp'
import { FakeEventSource } from '../__fixtures__/fakeEventSource'
import { createEventStream, useEventStream, type EventStream } from './useEventStream'

const latest = () => FakeEventSource.instances.at(-1)!

let visibility: DocumentVisibilityState = 'visible'
function setVisibility(value: DocumentVisibilityState) {
  visibility = value
  document.dispatchEvent(new Event('visibilitychange'))
}

const streams: EventStream[] = []
function stream() {
  const s = createEventStream({
    url: '/api/stream',
    hiddenCloseMs: 10_000,
    eventSource: FakeEventSource as unknown as typeof EventSource,
  })
  streams.push(s)
  return s
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeEventSource.instances = []
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  streams.splice(0).forEach((s) => s.close())
  vi.useRealTimers()
})

describe('createEventStream', () => {
  it('reopens a connection the browser gave up on, after 2 s', () => {
    const s = stream()
    const received: unknown[] = []
    s.on('arp', (data) => received.push(data))
    latest().open()
    latest().fail(true)
    expect(s.state.value).toBe('error')
    vi.advanceTimersByTime(1_999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(s.state.value).toBe('connecting')
    latest().emit('arp', { type: 'remove', id: '*1' })
    expect(received).toEqual([{ type: 'remove', id: '*1' }])
  })

  it('leaves a network drop to the browser', () => {
    const s = stream()
    latest().open()
    latest().fail(false)
    expect(s.state.value).toBe('error')
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('backs off 2, 4, 8, 16, 30, 30 s and resets after a successful open', () => {
    const s = stream()
    const delays: number[] = []
    const failUntilNext = () => {
      const before = FakeEventSource.instances.length
      latest().fail(true)
      let waited = 0
      while (FakeEventSource.instances.length === before) {
        vi.advanceTimersByTime(1_000)
        waited += 1_000
      }
      delays.push(waited)
    }
    for (let i = 0; i < 6; i++) failUntilNext()
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
    expect(s.state.value).toBe('connecting')

    latest().open()
    delays.length = 0
    failUntilNext()
    expect(delays).toEqual([2_000])
  })

  it('does not reconnect while paused for a hidden tab, and reopens when shown', () => {
    const s = stream()
    latest().fail(true) // t=0: retry due at 2 s
    setVisibility('hidden') // pause due at 10 s
    vi.advanceTimersByTime(2_000)
    expect(FakeEventSource.instances).toHaveLength(2)
    latest().fail(true) // retry due at 6 s
    vi.advanceTimersByTime(4_000)
    expect(FakeEventSource.instances).toHaveLength(3)
    latest().fail(true) // retry due at 14 s, after the pause
    vi.advanceTimersByTime(4_000)
    expect(s.state.value).toBe('paused')
    vi.advanceTimersByTime(120_000)
    expect(FakeEventSource.instances).toHaveLength(3)

    setVisibility('visible')
    expect(FakeEventSource.instances).toHaveLength(4)
    expect(s.state.value).toBe('connecting')
  })

  it('does not reconnect after close()', () => {
    const s = stream()
    latest().fail(true)
    s.close()
    vi.advanceTimersByTime(120_000)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(s.state.value).toBe('idle')
  })

  it('ignores late callbacks of a connection it already dropped', () => {
    const s = stream()
    const old = latest()
    old.fail(true)
    vi.advanceTimersByTime(2_000)
    old.onerror?.()
    old.onopen?.()
    expect(s.state.value).toBe('connecting')
    vi.advanceTimersByTime(120_000)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('opens one connection and routes events by name', () => {
    const s = stream()
    const arp: unknown[] = []
    const other: unknown[] = []
    s.on('arp', (data) => arp.push(data))
    s.on('proxmox', (data) => other.push(data))

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(latest().url).toBe('/api/stream')
    expect(s.state.value).toBe('connecting')
    latest().onopen?.()
    expect(s.state.value).toBe('open')

    latest().emit('arp', { type: 'remove', id: '*1' })
    latest().emit('arp', 'not json')
    latest().emit('proxmox', { n: 1 })
    expect(arp).toEqual([{ type: 'remove', id: '*1' }])
    expect(other).toEqual([{ n: 1 }])

    latest().onerror?.()
    expect(s.state.value).toBe('error')
  })

  it('closes after the tab has been hidden for 10 s and reopens when it is shown', () => {
    const s = stream()
    const received: unknown[] = []
    s.on('arp', (data) => received.push(data))
    const first = latest()

    setVisibility('hidden')
    vi.advanceTimersByTime(9_999)
    expect(first.closed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(first.closed).toBe(true)
    expect(s.state.value).toBe('paused')

    setVisibility('visible')
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(s.state.value).toBe('connecting')
    latest().emit('arp', { type: 'remove', id: '*2' })
    expect(received).toEqual([{ type: 'remove', id: '*2' }])  // listeners moved to the new connection
  })

  it('keeps the connection through a short hide', () => {
    const s = stream()
    setVisibility('hidden')
    vi.advanceTimersByTime(5_000)
    setVisibility('visible')
    vi.advanceTimersByTime(20_000)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(latest().closed).toBe(false)
    expect(s.state.value).toBe('connecting')
  })

  it('stops reacting to visibility once closed', () => {
    const s = stream()
    s.close()
    expect(latest().closed).toBe(true)
    setVisibility('hidden')
    vi.advanceTimersByTime(20_000)
    setVisibility('visible')
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(s.state.value).toBe('idle')
  })
})

const row = (id: string, status: string, presence: ArpRow['presence']): ArpRow => ({
  id,
  address: `192.0.2.${id.slice(1)}`,
  mac: '02:00:00:00:00:AA',
  interface: 'vlan10',
  status,
  presence,
  dhcp: false,
  dynamic: true,
  disabled: false,
  macSource: 'arp',
  lease: null,
  netbox: { kind: 'device', id: '1', name: 'srv-a', role: 'Server', status: 'active', description: '', interface: null, url: null },
})

describe('useArp on the shared stream', () => {
  it('keeps its rows across a hidden-tab close and reopen until a fresh snapshot arrives', () => {
    const s = stream()
    const scope = effectScope()
    const arp = scope.run(() => useArp(s))!
    latest().onopen?.()
    latest().emit('arp', { type: 'status', state: 'live', error: null })
    latest().emit('arp', { type: 'snapshot', rows: [row('*1', 'reachable', 'active')] })
    expect(arp.phase.value).toBe('live')
    expect([...arp.rows.value.keys()]).toEqual(['*1'])
    const presence = arp.presence.value

    setVisibility('hidden')
    vi.advanceTimersByTime(10_000)
    expect(s.state.value).toBe('paused')
    expect([...arp.rows.value.keys()]).toEqual(['*1'])
    expect(arp.phase.value).toBe('live')
    expect(arp.errorMessage.value).toBeNull()

    setVisibility('visible')
    // The backend session restarted: status first, rows still on screen.
    latest().emit('arp', { type: 'status', state: 'connecting', error: null })
    expect([...arp.rows.value.keys()]).toEqual(['*1'])
    expect(arp.presence.value).toBe(presence)
    expect(arp.phase.value).toBe('live')

    latest().emit('arp', { type: 'snapshot', rows: [row('*2', 'stale', 'active')] })
    expect([...arp.rows.value.keys()]).toEqual(['*2'])
    scope.stop()
  })

  it('reports an unreachable stream and recovers when it reopens', () => {
    const s = stream()
    const scope = effectScope()
    const arp = scope.run(() => useArp(s))!
    latest().onerror?.()
    expect(arp.phase.value).toBe('failed')
    expect(arp.errorMessage.value).toBe('The ARP stream of the status backend is unreachable.')
    latest().onopen?.()
    expect(arp.phase.value).toBe('loading')
    scope.stop()
  })

  it('unsubscribes with its scope', () => {
    const s = stream()
    const scope = effectScope()
    const arp = scope.run(() => useArp(s))!
    scope.stop()
    latest().emit('arp', { type: 'snapshot', rows: [row('*1', 'reachable', 'active')] })
    expect(arp.hasData.value).toBe(false)
  })
})

describe('useEventStream', () => {
  it('shares one connection between users and closes it with the last one', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const a = effectScope()
    const b = effectScope()
    const first = a.run(() => useEventStream())!
    const second = b.run(() => useEventStream())!
    expect(first).toBe(second)
    expect(FakeEventSource.instances).toHaveLength(1)
    a.stop()
    expect(latest().closed).toBe(false)
    b.stop()
    expect(latest().closed).toBe(true)

    const c = effectScope()
    c.run(() => useEventStream())
    expect(FakeEventSource.instances).toHaveLength(2)
    c.stop()
    vi.unstubAllGlobals()
  })
})
