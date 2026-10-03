import { fetchStatuses } from '../api/status'
import { indexStatuses } from '../domain/statuses'
import type { StatusEntry } from '../types/status'
import { type LivePhase, useLiveSource } from './useLiveSource'

export type StatusPhase = LivePhase

/**
 * Live service checks. Results are cleared when a load starts, so stale statuses
 * are never shown next to a refresh in progress.
 */
export function useStatuses() {
  return useLiveSource<StatusEntry[], Map<string, StatusEntry>>({
    fetcher: fetchStatuses,
    indexer: indexStatuses,
    defaultIndex: new Map<string, StatusEntry>(),
  })
}
