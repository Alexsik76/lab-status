import type { StatusEntry } from '../types/status'

/** Index status entries by NetBox service id; entries without one are not tied to a service. */
export function indexStatuses(entries: readonly StatusEntry[]): Map<string, StatusEntry> {
  const index = new Map<string, StatusEntry>()
  for (const entry of entries) {
    if (entry.service_id == null) continue
    const key = String(entry.service_id)
    // First entry wins if a service is ever checked twice.
    if (!index.has(key)) index.set(key, entry)
  }
  return index
}
