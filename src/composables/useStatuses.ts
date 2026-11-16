import { computed, onScopeDispose, readonly, shallowRef } from 'vue'
import { errorMessage } from '../api/errors'
import { parseStatusResponse } from '../api/status'
import { indexStatuses } from '../domain/statuses'
import type { StatusEntry } from '../types/status'
import type { PolledEvent, SourceStatus } from '../types/stream'
import { useEventStream, type EventStream } from './useEventStream'
import type { LivePhase } from './useLiveSource'

export type StatusPhase = LivePhase

/**
 * Live service checks: the `services` events of the shared stream (the backend checks on its
 * own schedule and on ARP / container events). The last statuses stay on screen while the
 * stream is down or paused, or while the backend reports an error.
 */
export function useStatuses(stream: EventStream = useEventStream()) {
  const data = shallowRef<StatusEntry[] | null>(null)
  const status = shallowRef<SourceStatus | null>(null)
  const parseError = shallowRef<string | null>(null)

  onScopeDispose(
    stream.on<PolledEvent<unknown>>('services', (event) => {
      if (event.type === 'status') {
        status.value = event
        return
      }
      try {
        data.value = parseStatusResponse(event.data)
        parseError.value = null
      } catch (err) {
        parseError.value = errorMessage(err)
      }
    }),
  )

  const message = computed(() => {
    if (parseError.value) return parseError.value
    if (status.value?.state === 'error') return status.value.error ?? 'Service checks failed.'
    if (stream.state.value === 'error') return 'The status backend stream is unreachable.'
    return null
  })

  const phase = computed<StatusPhase>(() => {
    if (message.value) return 'failed'
    return data.value ? 'ready' : 'loading'
  })

  return {
    phase,
    data: computed(() => data.value),
    index: computed(() => (data.value ? indexStatuses(data.value) : new Map<string, StatusEntry>())),
    errorMessage: message,
    status: readonly(status),
  }
}
