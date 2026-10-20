import { describe, expect, it } from 'vitest'
import { resolveHostDomainUrl, urlHostLabel } from './hostLinks'

const opts = { proxmoxWebUrl: 'https://prox.example.com/', domainUrls: { nas: 'https://nas.example.com' } }

describe('resolveHostDomainUrl', () => {
  it('links Proxmox VE nodes to the shared UI with the node preselected', () => {
    expect(resolveHostDomainUrl({ name: 'prox2', platform: 'Proxmox VE' }, opts)).toBe(
      'https://prox.example.com/#v1:0:=node/prox2',
    )
  })

  it('uses the explicit domain map for other servers', () => {
    expect(resolveHostDomainUrl({ name: 'nas', platform: 'TrueNAS' }, opts)).toBe(
      'https://nas.example.com',
    )
  })

  it('returns null when no domain is known', () => {
    expect(resolveHostDomainUrl({ name: 'prints', platform: 'Debian' }, opts)).toBeNull()
    expect(resolveHostDomainUrl({ name: 'x', platform: null }, opts)).toBeNull()
  })
})

describe('urlHostLabel', () => {
  it('extracts the host', () => {
    expect(urlHostLabel('https://prox.example.com/#v1:0:=node/prox1')).toBe('prox.example.com')
    expect(urlHostLabel('https://10.0.0.1:8006')).toBe('10.0.0.1:8006')
    expect(urlHostLabel(null)).toBeUndefined()
  })
})
