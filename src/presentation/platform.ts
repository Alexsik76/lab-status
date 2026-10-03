export interface PlatformIcon {
  kind: 'image' | 'svg'
  src?: string
  name: string
  alt: string
}

/**
 * Maps a NetBox platform name to an icon.
 * Returns null if no platform is provided or the platform is not mapped.
 * No fallbacks or heuristics.
 */
export function platformToIcon(platformName: string | null | undefined): PlatformIcon | null {
  if (!platformName) return null
  const trimmed = platformName.trim()
  switch (trimmed) {
    case 'Proxmox VE':
      return { kind: 'image', src: '/assets/proxmox-mark.svg', name: 'proxmox', alt: 'Proxmox VE' }
    case 'TrueNAS':
      return { kind: 'image', src: '/assets/truenas.svg', name: 'truenas', alt: 'TrueNAS' }
    case 'Debian':
      return { kind: 'image', src: '/assets/debian-dark.svg', name: 'debian', alt: 'Debian' }
    case 'Home Assistant OS':
      return { kind: 'svg', name: 'haos', alt: 'Home Assistant OS' }
    default:
      return null
  }
}
