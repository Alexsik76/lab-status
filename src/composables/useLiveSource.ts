import { computed } from 'vue'
import { useAsyncState } from '@vueuse/core'
import { errorMessage } from '../api/errors'

export type LivePhase = 'loading' | 'ready' | 'failed'

export interface LiveSourceOptions<TData, TIndex> {
  fetcher: () => Promise<TData>
  indexer?: (data: TData) => TIndex
  defaultIndex?: TIndex
}

/**
 * Generalized composable for live independent data sources (statuses, Docker container states).
 * Clears results when load starts so stale data is never shown during refresh.
 */
export function useLiveSource<TData, TIndex = TData>(options: LiveSourceOptions<TData, TIndex>) {
  const { state, isLoading, error, execute } = useAsyncState<TData | null>(options.fetcher, null, {
    shallow: true,
  })

  const phase = computed<LivePhase>(() => {
    if (state.value) return 'ready'
    return error.value ? 'failed' : 'loading'
  })

  const index = computed(() => {
    if (!state.value) return options.defaultIndex as TIndex
    return options.indexer ? options.indexer(state.value) : (state.value as unknown as TIndex)
  })

  return {
    phase,
    isLoading,
    data: state,
    index,
    errorMessage: computed(() => (error.value ? errorMessage(error.value) : null)),
    refresh: () => execute(),
  }
}
