import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArpRow } from '../types/arp'
import { useArp } from './useArp'
import { createEventStream, useEventStream, type EventStream } from './useEventStream'

/** Minimal EventSource double: tests drive open / error / named events by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  private listeners = new Map<string, ((message: MessageEvent<string>) => void)[]>()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(event: string, listener: (message: MessageEvent<string>) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  close() {
    this.closed = true
  }

  emit(event: string, data: unknown) {
    const message = { data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent<string>
    for (const listener of this.listeners.get(event) ?? []) listener(message)
  }
}

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
