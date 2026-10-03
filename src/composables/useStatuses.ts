import { computed } from 'vue'
import { useAsyncState } from '@vueuse/core'
import { fetchStatuses } from '../api/status'
import { errorMessage } from '../api/errors'
import { indexStatuses } from '../domain/statuses'
import type { StatusEntry } from '../types/status'

export type StatusPhase = 'loading' | 'ready' | 'failed'

/**
 * Live service checks. Results are cleared when a load starts, so stale statuses
 * are never shown next to a refresh in progress.
 */
export function useStatuses() {
  const { state, isLoading, error, execute } = useAsyncState<StatusEntry[] | null>(fetchStatuses, null, {
    shallow: true,
  })

  const phase = computed<StatusPhase>(() => {
    if (state.value) return 'ready'
    return error.value ? 'failed' : 'loading'
  })

  return {
    phase,
    isLoading,
    index: computed(() => (state.value ? indexStatuses(state.value) : new Map<string, StatusEntry>())),
    errorMessage: computed(() => (error.value ? errorMessage(error.value) : null)),
    refresh: () => execute(),
  }
}
