import { computed, onScopeDispose, readonly, shallowRef } from 'vue'
import type { ProxmoxData, ProxmoxResourceItem, ProxmoxRrdPoint } from '../types/proxmox'
import type { PolledEvent, SourceStatus } from '../types/stream'
import { useEventStream, type EventStream } from './useEventStream'
import type { LivePhase } from './useLiveSource'

/**
 * Live Proxmox cluster resources (`proxmox` events) and node load graphs (`metrics` events)
 * from the app's shared stream; the backend polls Proxmox. The last data stays on screen
 * while the stream is down or paused, or while the backend reports a failed poll.
 */
export function useProxmox(stream: EventStream = useEventStream()) {
  const resources = shallowRef<ProxmoxResourceItem[] | null>(null)
  const rrdByNode = shallowRef<Record<string, ProxmoxRrdPoint[]>>({})
  const status = shallowRef<SourceStatus | null>(null)
  const metricsStatus = shallowRef<SourceStatus | null>(null)

  onScopeDispose(
    stream.on<PolledEvent<ProxmoxResourceItem[]>>('proxmox', (event) => {
      if (event.type === 'status') status.value = event
      else if (Array.isArray(event.data)) resources.value = event.data
    }),
  )
  onScopeDispose(
    stream.on<PolledEvent<Record<string, ProxmoxRrdPoint[]>>>('metrics', (event) => {
      if (event.type === 'status') metricsStatus.value = event
      else if (event.data && typeof event.data === 'object') rrdByNode.value = event.data
    }),
  )

  const data = computed<ProxmoxData | null>(() =>
    resources.value ? { resources: resources.value, rrdByNode: rrdByNode.value } : null,
  )

  const streamDown = computed(() => stream.state.value === 'error')

  const phase = computed<LivePhase>(() => {
    if (status.value?.state === 'error' || streamDown.value) return 'failed'
    return data.value ? 'ready' : 'loading'
  })

  const errorMessage = computed(() => {
    if (status.value?.state === 'error') return status.value.error ?? 'Proxmox polling failed.'
    if (streamDown.value) return 'The status backend stream is unreachable.'
    return null
  })

  return {
    phase,
    data,
    errorMessage,
    /** Backend status of the two sources, for the freshness indicator of a later stage. */
    status: readonly(status),
    metricsStatus: readonly(metricsStatus),
  }
}
