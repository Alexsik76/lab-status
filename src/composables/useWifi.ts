import { computed, onScopeDispose, shallowRef } from 'vue'
import type { LivePhase, PolledEvent, SourceStatus } from '../types/stream'
import type { WifiData } from '../types/wifi'
import { useEventStream, type EventStream } from './useEventStream'

const isWifiData = (data: unknown): data is WifiData => {
  if (!data || typeof data !== 'object') return false
  const d = data as Partial<WifiData>
  return [d.networks, d.aps, d.radios, d.clients].every(Array.isArray)
}

/**
 * Wireless networks from the router's CAPsMAN (`wifi` events of the shared stream; the
 * backend polls the router). A failed read arrives as an empty snapshot and a status error.
 */
export function useWifi(stream: EventStream = useEventStream()) {
  const data = shallowRef<WifiData | null>(null)
  const status = shallowRef<SourceStatus | null>(null)

  onScopeDispose(
    stream.on<PolledEvent<WifiData>>('wifi', (event) => {
      if (event.type === 'status') status.value = event
      else if (isWifiData(event.data)) data.value = event.data
    }),
  )

  const streamDown = computed(() => stream.state.value === 'error')
  const phase = computed<LivePhase>(() => {
    if (status.value?.state === 'error' || streamDown.value) return 'failed'
    return data.value ? 'ready' : 'loading'
  })
  const errorMessage = computed(() => {
    if (status.value?.state === 'error') return status.value.error ?? 'Wi-Fi: the router could not be read.'
    if (streamDown.value) return 'The status backend stream is unreachable.'
    return null
  })

  return { data: computed(() => data.value), phase, errorMessage }
}
