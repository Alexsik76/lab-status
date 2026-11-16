import { onScopeDispose, readonly, shallowRef } from 'vue'
import type { SourceState } from '../types/stream'
import { useEventStream, type EventStream } from './useEventStream'

/** The backend sources, in the order the clock's tooltip lists them. */
export const SOURCE_NAMES = ['inventory', 'services', 'proxmox', 'metrics', 'containers', 'arp'] as const
export type SourceName = (typeof SOURCE_NAMES)[number]

/** The latest `status` event of a source (the ARP mirror's carries no time or period). */
export interface AnySourceStatus {
  state: SourceState
  error: string | null
  updatedAt?: string | null
  periodS?: number
}

export type SourceStatuses = Partial<Record<SourceName, AnySourceStatus>>

/** Every source's latest status event from the shared stream, for the refresh clock. */
export function useSourceStatuses(stream: EventStream = useEventStream()) {
  const statuses = shallowRef<SourceStatuses>({})
  for (const name of SOURCE_NAMES) {
    onScopeDispose(
      stream.on<{ type: string } & AnySourceStatus>(name, (event) => {
        if (event.type !== 'status') return
        const { state, error, updatedAt, periodS } = event
        statuses.value = { ...statuses.value, [name]: { state, error, updatedAt, periodS } }
      }),
    )
  }
  return { statuses: readonly(statuses), streamState: stream.state }
}
