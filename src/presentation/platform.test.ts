import { describe, expect, it } from 'vitest'
import { platformToIcon, resolveIcon } from './platform'

describe('platformToIcon', () => {
  it('maps "Proxmox VE" to the Proxmox icon', () => {
    const icon = platformToIcon('Proxmox VE')
    expect(icon).toEqual({
      kind: 'image',
      src: '/assets/proxmox-mark.svg',
      name: 'proxmox',
      alt: 'Proxmox VE',
    })
  })

  it('maps "TrueNAS" to the TrueNAS icon', () => {
    const icon = platformToIcon('TrueNAS')
    expect(icon).toEqual({
      kind: 'image',
      src: '/assets/truenas.svg',
      name: 'truenas',
      alt: 'TrueNAS',
    })
  })

  it('maps "Debian" to the Debian icon', () => {
    const icon = platformToIcon('Debian')
    expect(icon).toEqual({
      kind: 'image',
      src: '/assets/debian-dark.svg',
      name: 'debian',
      alt: 'Debian',
    })
  })

  it('maps "Home Assistant OS" to the HAOS svg icon', () => {
    const icon = platformToIcon('Home Assistant OS')
    expect(icon).toEqual({
      kind: 'svg',
      name: 'haos',
      alt: 'Home Assistant OS',
    })
  })

  it('returns null for null, undefined, or empty string', () => {
    expect(platformToIcon(null)).toBeNull()
    expect(platformToIcon(undefined)).toBeNull()
    expect(platformToIcon('')).toBeNull()
    expect(platformToIcon('   ')).toBeNull()
  })

  it('returns null for unknown platforms without inventing fallbacks', () => {
    expect(platformToIcon('Ubuntu')).toBeNull()
    expect(platformToIcon('Windows Server')).toBeNull()
    expect(platformToIcon('CustomOS')).toBeNull()
  })
})

describe('resolveIcon', () => {
  it('prefers the icon set explicitly over the platform', () => {
    expect(resolveIcon('cups', 'Debian')).toMatchObject({ name: 'cups', src: '/assets/cups.svg' })
  })

  it('takes the platform icon when nothing is set explicitly', () => {
    expect(resolveIcon(null, 'TrueNAS').name).toBe('truenas')
  })

  it('falls back to the generic server icon for unknown or missing platforms', () => {
    expect(resolveIcon(null, 'Windows')).toEqual({ kind: 'svg', name: 'server', alt: 'Server' })
    expect(resolveIcon(undefined, null).name).toBe('server')
  })
})
