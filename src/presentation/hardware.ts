import type { DeviceHardware } from '../domain/model'

const positive = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0

/** Gigabytes as "512G", or terabytes from 1024 GB on: "5.1T" (one decimal, ".0" dropped). */
function formatSize(gb: number, short: boolean): string {
  if (gb < 1024) return short ? `${gb}G` : `${gb} GB`
  const tb = Math.round((gb / 1024) * 10) / 10
  return short ? `${tb}T` : `${tb} TB`
}

/**
 * Formats device hardware specs (CPU cores, RAM in GB, storage in GB)
 * into a compact string like "8c · 16G · 5.1T".
 * Returns null if no hardware figures are set.
 */
export function formatHardware(hw: DeviceHardware | null | undefined): string | null {
  if (!hw) return null
  const parts: string[] = []
  if (positive(hw.cpuCores)) parts.push(`${hw.cpuCores}c`)
  if (positive(hw.memoryGb)) parts.push(formatSize(hw.memoryGb, true))
  if (positive(hw.storageGb)) parts.push(formatSize(hw.storageGb, true))
  return parts.length > 0 ? parts.join(' · ') : null
}

/** The same figures spelled out, for the tooltip: "4 CPU cores · 16 GB RAM · 5.1 TB storage". */
export function describeHardware(hw: DeviceHardware | null | undefined): string | null {
  if (!hw) return null
  const parts: string[] = []
  if (positive(hw.cpuCores)) parts.push(`${hw.cpuCores} CPU ${hw.cpuCores === 1 ? 'core' : 'cores'}`)
  if (positive(hw.memoryGb)) parts.push(`${formatSize(hw.memoryGb, false)} RAM`)
  if (positive(hw.storageGb)) parts.push(`${formatSize(hw.storageGb, false)} storage`)
  return parts.length > 0 ? parts.join(' · ') : null
}
