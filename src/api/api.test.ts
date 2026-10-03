import { afterEach, describe, expect, it, vi } from 'vitest'
import { netboxResponse, statusEntries } from '../__fixtures__'
import { ApiError } from './errors'
import { fetchJson } from './http'
import { parseInventoryResponse } from './netbox'
import { parseStatusResponse } from './status'

const OPTIONS = { source: 'NetBox', timeoutMs: 5000 }

afterEach(() => vi.unstubAllGlobals())

const stubFetch = (impl: () => Promise<unknown>) => vi.stubGlobal('fetch', vi.fn(impl))
const jsonResponse = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init)

describe('fetchJson', () => {
  it('returns the parsed body', async () => {
    stubFetch(async () => jsonResponse({ ok: 1 }))
    await expect(fetchJson('/x', OPTIONS)).resolves.toEqual({ ok: 1 })
  })

  it('maps a network failure', async () => {
    stubFetch(async () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(fetchJson('/x', OPTIONS)).rejects.toMatchObject({
      kind: 'network',
      message: 'NetBox is unreachable.',
    })
  })

  it('maps a timeout', async () => {
    stubFetch(async () => Promise.reject(new DOMException('timed out', 'TimeoutError')))
    await expect(fetchJson('/x', OPTIONS)).rejects.toMatchObject({
      kind: 'timeout',
      message: 'NetBox did not respond within 5 s.',
    })
  })

  it('maps an HTTP error', async () => {
    stubFetch(async () => new Response('bad gateway', { status: 502, statusText: 'Bad Gateway' }))
    await expect(fetchJson('/x', OPTIONS)).rejects.toMatchObject({
      kind: 'http',
      message: 'NetBox responded with HTTP 502 Bad Gateway.',
    })
  })

  it('maps a body that is not JSON', async () => {
    stubFetch(async () => new Response('<html>', { status: 200 }))
    await expect(fetchJson('/x', OPTIONS)).rejects.toMatchObject({ kind: 'invalid' })
  })
})

describe('parseInventoryResponse', () => {
  it('normalizes the real response', () => {
    const inventory = parseInventoryResponse(netboxResponse)
    expect(inventory.vms.length).toBeGreaterThan(0)
  })

  it('surfaces GraphQL errors', () => {
    expect(() => parseInventoryResponse({ errors: [{ message: 'Unauthorized' }] })).toThrow(/Unauthorized/)
  })

  it('rejects a response without inventory data', () => {
    expect(() => parseInventoryResponse({ data: null })).toThrow(ApiError)
    expect(() => parseInventoryResponse({ data: { device_list: [] } })).toThrow(ApiError)
  })
})

describe('parseStatusResponse', () => {
  it('accepts the real response', () => {
    expect(parseStatusResponse(statusEntries)).toHaveLength(statusEntries.length)
  })

  it('accepts an empty list', () => {
    expect(parseStatusResponse([])).toEqual([])
  })

  it('rejects anything that is not a list of checks', () => {
    expect(() => parseStatusResponse({ message: 'Workflow error' })).toThrow(ApiError)
    expect(() => parseStatusResponse([{ name: 'x' }])).toThrow(ApiError)
  })
})
