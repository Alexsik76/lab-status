import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { containerStatusEntries } from '../__fixtures__'
import { FakeEventSource } from '../__fixtures__/fakeEventSource'
import { useContainerStatuses } from './useContainerStatuses'
import { createEventStream, type EventStream } from './useEventStream'

const status = (state: string, error: string | null = null) => ({
  type: 'status',
  state,
  error,
  updatedAt: '2026-11-16T12:00:00Z',
  periodS: 300,
})

let stream: EventStream

beforeEach(() => {
  FakeEventSource.instances = []
  stream = createEventStream({ url: '/api/stream', eventSource: FakeEventSource as unknown as typeof EventSource })
})

afterEach(() => stream.close())

const mountContainers = () => effectScope().run(() => useContainerStatuses(stream))!

describe('useContainerStatuses on the shared stream', () => {
  it('exposes the list from containers events', () => {
    const containers = mountContainers()
    const es = FakeEventSource.latest()
    es.open()
    expect(containers.phase.value).toBe('loading')
    es.emit('containers', { type: 'data', data: containerStatusEntries })
    es.emit('containers', status('live'))
    expect(containers.phase.value).toBe('ready')
    expect(containers.data.value).toEqual(containerStatusEntries)
    expect(containers.errorMessage.value).toBeNull()
  })

  it('treats one failed environment next to a live one as no failure', () => {
    const containers = mountContainers()
    const es = FakeEventSource.latest()
    es.open()
    es.emit('containers', { type: 'data', data: containerStatusEntries })
    es.emit('containers', status('live', 'docker-2: Portainer is unreachable.'))
    expect(containers.phase.value).toBe('ready')
    expect(containers.status.value?.error).toBe('docker-2: Portainer is unreachable.')
  })

  it('keeps the last list when the source fails, and recovers', () => {
    const containers = mountContainers()
    const es = FakeEventSource.latest()
    es.open()
    es.emit('containers', { type: 'data', data: containerStatusEntries })
    es.emit('containers', status('error', 'docker-1: Portainer is unreachable.; docker-2: Portainer is unreachable.'))
    expect(containers.phase.value).toBe('failed')
    expect(containers.errorMessage.value).toContain('docker-1: Portainer is unreachable.')
    expect(containers.data.value).toEqual(containerStatusEntries)
    es.emit('containers', status('live'))
    expect(containers.phase.value).toBe('ready')
  })

  it('rejects a malformed payload and keeps the last list', () => {
    const containers = mountContainers()
    const es = FakeEventSource.latest()
    es.emit('containers', { type: 'data', data: containerStatusEntries })
    es.emit('containers', { type: 'data', data: [{ env: 'docker-1' }] })
    expect(containers.errorMessage.value).toBe('The container state source returned an unexpected response.')
    expect(containers.data.value).toEqual(containerStatusEntries)
  })

  it('reports the stream being down without dropping the list', () => {
    const containers = mountContainers()
    const es = FakeEventSource.latest()
    es.open()
    es.emit('containers', { type: 'data', data: containerStatusEntries })
    es.fail(false)
    expect(containers.phase.value).toBe('failed')
    expect(containers.data.value).toEqual(containerStatusEntries)
  })
})
