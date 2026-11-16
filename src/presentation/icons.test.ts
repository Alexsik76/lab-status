import { describe, expect, it } from 'vitest'
import { DASHBOARD_ICONS_COMMIT, iconUrl } from './icons'

describe('iconUrl', () => {
  it('points to the pinned Dashboard Icons SVG', () => {
    expect(iconUrl('debian-linux')).toBe(
      `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@${DASHBOARD_ICONS_COMMIT}/svg/debian-linux.svg`,
    )
  })

  it('returns null for a missing or malformed name', () => {
    expect(iconUrl(null)).toBeNull()
    expect(iconUrl('')).toBeNull()
    expect(iconUrl('../evil')).toBeNull()
    expect(iconUrl('Debian')).toBeNull()
  })
})
