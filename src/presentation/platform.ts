export interface PlatformIcon {
  kind: 'image' | 'svg'
  src?: string
  name: string
  alt: string
}

/** Every icon a machine or guest can show, by name. */
export const ICONS = {
  proxmox: { kind: 'image', src: '/assets/proxmox-mark.svg', name: 'proxmox', alt: 'Proxmox VE' },
  truenas: { kind: 'image', src: '/assets/truenas.svg', name: 'truenas', alt: 'TrueNAS' },
  debian: { kind: 'image', src: '/assets/debian-dark.svg', name: 'debian', alt: 'Debian' },
  haos: { kind: 'svg', name: 'haos', alt: 'Home Assistant OS' },
  cups: { kind: 'image', src: '/assets/cups.svg', name: 'cups', alt: 'CUPS' },
  server: { kind: 'svg', name: 'server', alt: 'Server' },
} as const satisfies Record<string, PlatformIcon>

export type IconName = keyof typeof ICONS

const PLATFORM_ICONS: Readonly<Record<string, IconName>> = {
  'Proxmox VE': 'proxmox',
  TrueNAS: 'truenas',
  Debian: 'debian',
  'Home Assistant OS': 'haos',
}

/**
 * Maps a NetBox platform name to an icon.
 * Returns null if no platform is provided or the platform is not mapped.
 */
export function platformToIcon(platformName: string | null | undefined): PlatformIcon | null {
  const name = platformName ? PLATFORM_ICONS[platformName.trim()] : undefined
  return name ? { ...ICONS[name] } : null
}

/**
 * The icon to show: the one set explicitly (e.g. per host in config), else the
 * platform's, else the generic server icon — a machine or guest always has one.
 */
export function resolveIcon(
  explicit: IconName | null | undefined,
  platformName: string | null | undefined,
): PlatformIcon {
  if (explicit) return { ...ICONS[explicit] }
  return platformToIcon(platformName) ?? { ...ICONS.server }
}
