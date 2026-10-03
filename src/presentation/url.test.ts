import { describe, expect, it } from 'vitest'
import type { ServiceItem } from '../domain/model'
import { getNodePrimaryUrlAndPort, resolveServiceUrl } from './url'

function mockService(partial: Partial<ServiceItem>): ServiceItem {
  return {
    id: '1',
    name: 'test-svc',
    ports: [],
    scheme: null,
    addresses: [],
    url: null,
    state: 'up',
    httpCode: 200,
    error: null,
    ...partial,
  }
}

describe('resolveServiceUrl', () => {
  it('prefers existing service.url', () => {
    const svc = mockService({ url: 'https://custom.domain/path', scheme: 'http', ports: [80] })
    expect(resolveServiceUrl(svc, '192.0.2.1')).toBe('https://custom.domain/path')
  })

  it('uses scheme and address if present', () => {
    const svc = mockService({ scheme: 'https', ports: [8006], addresses: ['192.0.2.11'] })
    expect(resolveServiceUrl(svc)).toBe('https://192.0.2.11:8006')
  })

  it('omits default ports for http (80) and https (443)', () => {
    const httpSvc = mockService({ scheme: 'http', ports: [80], addresses: ['192.0.2.10'] })
    expect(resolveServiceUrl(httpSvc)).toBe('http://192.0.2.10')

    const httpsSvc = mockService({ scheme: 'https', ports: [443], addresses: ['192.0.2.10'] })
    expect(resolveServiceUrl(httpsSvc)).toBe('https://192.0.2.10')
  })

  it('uses fallbackIp when addresses are empty', () => {
    const svc = mockService({ scheme: 'http', ports: [8080], addresses: [] })
    expect(resolveServiceUrl(svc, '198.51.100.20')).toBe('http://198.51.100.20:8080')
  })

  it('returns null when scheme is null (even if port is 443 or 80)', () => {
    const svc = mockService({ scheme: null, ports: [443], addresses: ['192.0.2.1'] })
    expect(resolveServiceUrl(svc)).toBeNull()
  })

  it('returns null when no IP is available', () => {
    const svc = mockService({ scheme: 'http', ports: [80], addresses: [] })
    expect(resolveServiceUrl(svc, null)).toBeNull()
  })
})

describe('getNodePrimaryUrlAndPort', () => {
  it('returns portText without url when scheme is null', () => {
    const svc = mockService({ scheme: null, ports: [5433] })
    const res = getNodePrimaryUrlAndPort([svc], '192.0.2.10')
    expect(res).toEqual({ url: null, portText: ':5433' })
  })

  it('returns empty info when services list is empty', () => {
    const res = getNodePrimaryUrlAndPort([], '192.0.2.10')
    expect(res).toEqual({ url: null, portText: '' })
  })
})
