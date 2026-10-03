import type { DeviceHardware } from '../domain/model'

/**
 * Formats device hardware specs (CPU cores, RAM in GB, storage in GB)
 * into a compact string like "8c · 15G · 500G".
 * Returns null if no hardware figures are set.
 */
export function formatHardware(hw: DeviceHardware | null | undefined): string | null {
  if (!hw) return null
  const parts: string[] = []
  if (typeof hw.cpuCores === 'number' && Number.isFinite(hw.cpuCores) && hw.cpuCores > 0) {
    parts.push(`${hw.cpuCores}c`)
  }
  if (typeof hw.memoryGb === 'number' && Number.isFinite(hw.memoryGb) && hw.memoryGb > 0) {
    parts.push(`${hw.memoryGb}G`)
  }
  if (typeof hw.storageGb === 'number' && Number.isFinite(hw.storageGb) && hw.storageGb > 0) {
    parts.push(`${hw.storageGb}G`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}
