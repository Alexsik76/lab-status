import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { proxmoxResources, proxmoxRrdPoints } from '../__fixtures__'
import { FakeEventSource } from '../__fixtures__/fakeEventSource'
import { createEventStream, type EventStream } from './useEventStream'
import { useProxmox } from './useProxmox'

const status = (state: string, error: string | null = null) => ({
  type: 'status',
  state,
  error,
  updatedAt: '2026-11-16T12:00:00Z',
  periodS: 15,
})

let stream: EventStream

beforeEach(() => {
  FakeEventSource.instances = []
  stream = createEventStream({ url: '/api/stream', eventSource: FakeEventSource as unknown as typeof EventSource })
})

afterEach(() => {
  stream.close()
})

function mountProxmox() {
  return effectScope().run(() => useProxmox(stream))!
}

describe('useProxmox on the shared stream', () => {
  it('builds the same data shape from proxmox and metrics events', () => {
    const proxmox = mountProxmox()
    const es = FakeEventSource.latest()
    es.open()
    expect(proxmox.phase.value).toBe('loading')
    expect(proxmox.data.value).toBeNull()

    es.emit('proxmox', status('live'))
    es.emit('proxmox', { type: 'data', data: proxmoxResources })
    expect(proxmox.phase.value).toBe('ready')
    expect(proxmox.data.value).toEqual({ resources: proxmoxResources, rrdByNode: {} })

    es.emit('metrics', { type: 'data', data: { 'node-alpha': proxmoxRrdPoints, 'node-beta': [] } })
    expect(proxmox.data.value?.rrdByNode).toEqual({ 'node-alpha': proxmoxRrdPoints, 'node-beta': [] })
    expect(proxmox.errorMessage.value).toBeNull()
    expect(proxmox.status.value?.periodS).toBe(15)
  })

  it('reports a failed poll and keeps the last data, then recovers', () => {
    const proxmox = mountProxmox()
    const es = FakeEventSource.latest()
    es.open()
    es.emit('proxmox', { type: 'data', data: proxmoxResources })
    es.emit('proxmox', status('error', 'Proxmox responded with HTTP 502 Bad Gateway.'))
    expect(proxmox.phase.value).toBe('failed')
    expect(proxmox.errorMessage.value).toBe('Proxmox responded with HTTP 502 Bad Gateway.')
    expect(proxmox.data.value?.resources).toEqual(proxmoxResources)

    es.emit('proxmox', status('live'))
    expect(proxmox.phase.value).toBe('ready')
    expect(proxmox.errorMessage.value).toBeNull()
  })

  it('fails without data when Proxmox is unreachable from the start', () => {
    const proxmox = mountProxmox()
    FakeEventSource.latest().emit('proxmox', status('error', 'Proxmox is unreachable.'))
    expect(proxmox.phase.value).toBe('failed')
    expect(proxmox.data.value).toBeNull()
  })

  it('keeps the data while the stream is down, and says so', () => {
    const proxmox = mountProxmox()
    const es = FakeEventSource.latest()
    es.open()
    es.emit('proxmox', { type: 'data', data: proxmoxResources })
    es.fail(false)
    expect(proxmox.phase.value).toBe('failed')
    expect(proxmox.errorMessage.value).toBe('The status backend stream is unreachable.')
    expect(proxmox.data.value?.resources).toEqual(proxmoxResources)
    es.open()
    expect(proxmox.phase.value).toBe('ready')
  })

  it('stops listening with its scope', () => {
    const local = effectScope()
    const proxmox = local.run(() => useProxmox(stream))!
    local.stop()
    FakeEventSource.latest().emit('proxmox', { type: 'data', data: proxmoxResources })
    expect(proxmox.data.value).toBeNull()
  })
})
