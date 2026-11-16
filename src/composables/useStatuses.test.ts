import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { statusEntries } from '../__fixtures__'
import { FakeEventSource } from '../__fixtures__/fakeEventSource'
import { createEventStream, type EventStream } from './useEventStream'
import { useStatuses } from './useStatuses'

const status = (state: string, error: string | null = null) => ({
  type: 'status',
  state,
  error,
  updatedAt: '2026-11-17T01:00:00Z',
  periodS: 180,
})

let stream: EventStream

beforeEach(() => {
  FakeEventSource.instances = []
  stream = createEventStream({ url: '/api/stream', eventSource: FakeEventSource as unknown as typeof EventSource })
})

afterEach(() => stream.close())

const mountStatuses = () => effectScope().run(() => useStatuses(stream))!

describe('useStatuses on the shared stream', () => {
  it('exposes the list and its index from services events', () => {
    const statuses = mountStatuses()
    const es = FakeEventSource.latest()
    es.open()
    expect(statuses.phase.value).toBe('loading')
    expect(statuses.index.value.size).toBe(0)
    es.emit('services', { type: 'data', data: statusEntries })
    es.emit('services', status('live'))
    expect(statuses.phase.value).toBe('ready')
    expect(statuses.data.value).toEqual(statusEntries)
    expect(statuses.index.value.size).toBeGreaterThan(0)
    expect(statuses.errorMessage.value).toBeNull()
  })

  it('applies an event-driven update of one entry', () => {
    const statuses = mountStatuses()
    const es = FakeEventSource.latest()
    es.emit('services', { type: 'data', data: statusEntries })
    const changed = statusEntries.map((e, i) =>
      i === 0 ? { ...e, up: false, code: 0, error: 'Host does not answer ARP' } : e,
    )
    es.emit('services', { type: 'data', data: changed })
    expect(statuses.data.value?.[0]).toMatchObject({ up: false, error: 'Host does not answer ARP' })
  })

  it('keeps the last list when the source fails, and recovers', () => {
    const statuses = mountStatuses()
    const es = FakeEventSource.latest()
    es.open()
    es.emit('services', { type: 'data', data: statusEntries })
    es.emit('services', status('error', 'NetBox is unreachable.'))
    expect(statuses.phase.value).toBe('failed')
    expect(statuses.errorMessage.value).toBe('NetBox is unreachable.')
    expect(statuses.data.value).toEqual(statusEntries)
    es.emit('services', status('live'))
    expect(statuses.phase.value).toBe('ready')
  })

  it('rejects a malformed payload and keeps the last list', () => {
    const statuses = mountStatuses()
    const es = FakeEventSource.latest()
    es.emit('services', { type: 'data', data: statusEntries })
    es.emit('services', { type: 'data', data: { message: 'Workflow error' } })
    expect(statuses.errorMessage.value).toBe('The service check source returned an unexpected response.')
    expect(statuses.data.value).toEqual(statusEntries)
  })

  it('reports the stream being down without dropping the list', () => {
    const statuses = mountStatuses()
    const es = FakeEventSource.latest()
    es.open()
    es.emit('services', { type: 'data', data: statusEntries })
    es.fail(false)
    expect(statuses.phase.value).toBe('failed')
    expect(statuses.data.value).toEqual(statusEntries)
  })
})
