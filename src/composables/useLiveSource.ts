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
 * Generalized composable for live independent data sources (statuses, Docker container states, Proxmox).
 * The previous data is kept while a refresh is in flight or after a refresh failed,
 * so data is never cleared on screen once loaded.
 */
export function useLiveSource<TData, TIndex = TData>(options: LiveSourceOptions<TData, TIndex>) {
  const { state, isLoading, error, execute } = useAsyncState<TData | null>(options.fetcher, null, {
    shallow: true,
    resetOnExecute: false,
  })

  const phase = computed<LivePhase>(() => {
    if (error.value) return 'failed'
    if (state.value !== null) return 'ready'
    return 'loading'
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
