import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeEventSource } from '../__fixtures__/fakeEventSource'
import { createEventStream, type EventStream } from './useEventStream'
import { useSourceStatuses } from './useSourceStatuses'

let stream: EventStream

beforeEach(() => {
  FakeEventSource.instances = []
  stream = createEventStream({ url: '/api/stream', eventSource: FakeEventSource as unknown as typeof EventSource })
})

afterEach(() => stream.close())

describe('useSourceStatuses', () => {
  it('keeps the latest status event of every source and ignores data events', () => {
    const { statuses, streamState } = effectScope().run(() => useSourceStatuses(stream))!
    const es = FakeEventSource.latest()
    es.open()
    es.emit('inventory', { type: 'data', data: {} })
    es.emit('inventory', { type: 'status', state: 'live', error: null, updatedAt: '2026-11-17T01:00:00Z', periodS: 300 })
    es.emit('arp', { type: 'status', state: 'live', error: null })
    es.emit('arp', { type: 'snapshot', rows: [] })
    es.emit('proxmox', { type: 'status', state: 'error', error: 'Proxmox is unreachable.', updatedAt: null, periodS: 15 })
    expect(statuses.value).toEqual({
      inventory: { state: 'live', error: null, updatedAt: '2026-11-17T01:00:00Z', periodS: 300 },
      arp: { state: 'live', error: null, updatedAt: undefined, periodS: undefined },
      proxmox: { state: 'error', error: 'Proxmox is unreachable.', updatedAt: null, periodS: 15 },
    })
    expect(streamState.value).toBe('open')
  })
})
