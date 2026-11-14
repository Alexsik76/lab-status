import { describe, expect, it } from 'vitest'
import type { ServiceItem } from '../domain/model'
import { getNodePrimaryUrlAndPort, resolveServiceUrl, secondaryDirectUrl } from './url'

function mockService(partial: Partial<ServiceItem>): ServiceItem {
  return {
    id: '1',
    name: 'test-svc',
    ports: [],
    scheme: null,
    check: false,
    addresses: [],
    url: null,
    publicUrl: null,
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

  it.each(['rtsp', 'webrtc'])('never links a %s service', (scheme) => {
    const svc = mockService({ scheme, ports: [8554], addresses: ['192.0.2.10'], url: 'http://192.0.2.10:8554' })
    expect(resolveServiceUrl(svc, '192.0.2.1')).toBeNull()
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
    expect(res).toEqual({ url: null, directUrl: null, portText: ':5433' })
  })

  it('picks the service flagged check, not the first one with a scheme', () => {
    const other = mockService({ id: '1', scheme: 'http', ports: [80], addresses: ['192.0.2.10'] })
    const checked = mockService({ id: '2', scheme: 'https', ports: [8443], addresses: ['192.0.2.10'], check: true })
    expect(getNodePrimaryUrlAndPort([other, checked])).toEqual({
      url: 'https://192.0.2.10:8443',
      directUrl: 'https://192.0.2.10:8443',
      portText: ':8443',
    })
  })

  it('shows the port but no link when the check service is not http/https', () => {
    const svc = mockService({ scheme: 'rtsp', ports: [8554], addresses: ['192.0.2.10'], check: true })
    expect(getNodePrimaryUrlAndPort([svc])).toEqual({ url: null, directUrl: null, portText: ':8554' })
  })

  it('has no link without a check service, only the first port', () => {
    const svc = mockService({ scheme: 'http', ports: [8080], addresses: ['192.0.2.10'] })
    expect(getNodePrimaryUrlAndPort([svc], '192.0.2.10')).toEqual({ url: null, directUrl: null, portText: ':8080' })
  })

  it('returns empty info when services list is empty', () => {
    const res = getNodePrimaryUrlAndPort([], '192.0.2.10')
    expect(res).toEqual({ url: null, directUrl: null, portText: '' })
  })
})

describe('public (reverse-proxy) links', () => {
  const checked = (partial: Partial<ServiceItem>) =>
    mockService({
      scheme: 'http',
      ports: [9428],
      check: true,
      url: 'http://192.0.2.20:9428',
      ...partial,
    })

  it('links to the public URL and keeps the direct address as the secondary link', () => {
    const links = getNodePrimaryUrlAndPort([checked({ publicUrl: 'https://logs.example.com' })])
    expect(links).toEqual({
      url: 'https://logs.example.com',
      directUrl: 'http://192.0.2.20:9428',
      portText: ':9428',
    })
    expect(secondaryDirectUrl(links)).toBe('http://192.0.2.20:9428')
  })

  it('falls back to the direct URL without a public one, with no secondary link', () => {
    const links = getNodePrimaryUrlAndPort([checked({})])
    expect(links.url).toBe('http://192.0.2.20:9428')
    expect(secondaryDirectUrl(links)).toBeNull()
  })

  it('never links a public URL of a service that is not http/https', () => {
    const links = getNodePrimaryUrlAndPort([checked({ scheme: 'rtsp', publicUrl: 'https://cam.example.com' })])
    expect(links.url).toBeNull()
    expect(secondaryDirectUrl(links)).toBeNull()
  })

  it('ignores the public URL of services other than the check service', () => {
    const other = mockService({ id: '2', scheme: 'http', ports: [80], publicUrl: 'https://other.example.com' })
    const links = getNodePrimaryUrlAndPort([other, checked({})])
    expect(links.url).toBe('http://192.0.2.20:9428')
  })
})
