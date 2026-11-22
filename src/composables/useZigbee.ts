import { computed, onScopeDispose, shallowRef } from 'vue'
import type { LivePhase, PolledEvent, SourceStatus } from '../types/stream'
import type { ZigbeeData } from '../types/zigbee'
import { useEventStream, type EventStream } from './useEventStream'

const isZigbeeData = (data: unknown): data is ZigbeeData => {
  if (!data || typeof data !== 'object') return false
  const d = data as Partial<ZigbeeData>
  return Array.isArray(d.devices) && !!d.coordinator && typeof d.coordinator === 'object'
}

/**
 * The Zigbee2MQTT network from Home Assistant (`zigbee` events of the shared stream; the
 * backend polls Home Assistant read-only). A failed read arrives as an empty snapshot and a
 * status error.
 */
export function useZigbee(stream: EventStream = useEventStream()) {
  const data = shallowRef<ZigbeeData | null>(null)
  const status = shallowRef<SourceStatus | null>(null)

  onScopeDispose(
    stream.on<PolledEvent<ZigbeeData>>('zigbee', (event) => {
      if (event.type === 'status') status.value = event
      else if (isZigbeeData(event.data)) data.value = event.data
    }),
  )

  const streamDown = computed(() => stream.state.value === 'error')
  const phase = computed<LivePhase>(() => {
    if (status.value?.state === 'error' || streamDown.value) return 'failed'
    return data.value ? 'ready' : 'loading'
  })
  const errorMessage = computed(() => {
    if (status.value?.state === 'error') return status.value.error ?? 'Zigbee: Home Assistant could not be read.'
    if (streamDown.value) return 'The status backend stream is unreachable.'
    return null
  })

  return { data: computed(() => data.value), phase, errorMessage }
}
