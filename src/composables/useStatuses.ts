import { fetchStatuses } from '../api/status'
import { indexStatuses } from '../domain/statuses'
import type { StatusEntry } from '../types/status'
import { type LivePhase, useLiveSource } from './useLiveSource'

export type StatusPhase = LivePhase

/**
 * Live service checks. The previous statuses are kept while a refresh is in flight
 * or after a refresh failed.
 */
export function useStatuses() {
  return useLiveSource<StatusEntry[], Map<string, StatusEntry>>({
    fetcher: fetchStatuses,
    indexer: indexStatuses,
    defaultIndex: new Map<string, StatusEntry>(),
  })
}
