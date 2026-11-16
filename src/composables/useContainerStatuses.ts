import { computed, onScopeDispose, readonly, shallowRef } from 'vue'
import { errorMessage } from '../api/errors'
import { parseContainerStatusResponse } from '../api/containerStatus'
import type { DockerContainerEntry } from '../types/containerStatus'
import type { LivePhase, PolledEvent, SourceStatus } from '../types/stream'
import { useEventStream, type EventStream } from './useEventStream'

export type ContainerStatusPhase = LivePhase

/**
 * Live Docker container states: the `containers` events of the shared stream (the backend
 * follows Portainer's Docker events). The last list stays on screen while the stream is down
 * or paused, or while the backend reports an error. An environment that fails while another
 * stays live is reported by the backend as `live` with an `error`; that is not a failure here.
 */
export function useContainerStatuses(stream: EventStream = useEventStream()) {
  const data = shallowRef<DockerContainerEntry[] | null>(null)
  const status = shallowRef<SourceStatus | null>(null)
  const parseError = shallowRef<string | null>(null)

  onScopeDispose(
    stream.on<PolledEvent<unknown>>('containers', (event) => {
      if (event.type === 'status') {
        status.value = event
        return
      }
      try {
        data.value = parseContainerStatusResponse(event.data)
        parseError.value = null
      } catch (err) {
        parseError.value = errorMessage(err)
      }
    }),
  )

  const streamDown = computed(() => stream.state.value === 'error')

  const message = computed(() => {
    if (parseError.value) return parseError.value
    if (status.value?.state === 'error') return status.value.error ?? 'Container states could not be read.'
    if (streamDown.value) return 'The status backend stream is unreachable.'
    return null
  })

  const phase = computed<ContainerStatusPhase>(() => {
    if (message.value) return 'failed'
    return data.value ? 'ready' : 'loading'
  })

  return {
    phase,
    data: computed(() => data.value),
    errorMessage: message,
    status: readonly(status),
  }
}
