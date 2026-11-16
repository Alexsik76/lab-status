/** State of a backend source, as reported in its `status` events. */
export type SourceState = 'idle' | 'connecting' | 'live' | 'error'

/** `status` event of a periodic (polling) backend source. */
export interface SourceStatus {
  type: 'status'
  state: SourceState
  error: string | null
  /** Time of the last successful fetch (ISO 8601, UTC), null before the first one. */
  updatedAt: string | null
  /** Polling period of the source, in seconds. */
  periodS: number
}

/** Events of a periodic backend source: its status, and its data whenever it changed. */
export type PolledEvent<T> = SourceStatus | { type: 'data'; data: T }

/** Phase of a live data source on the page: waiting for its first data, showing it, or failing. */
export type LivePhase = 'loading' | 'ready' | 'failed'
