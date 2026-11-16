import { computed, onScopeDispose, readonly, ref, shallowRef } from 'vue'
import { applyArpEvent, indexArpPresence, samePresence, type ArpPresenceIndex, type ArpRows } from '../domain/arp'
import type { ArpEvent, ArpMirrorState } from '../types/arp'
import { useEventStream, type EventStream } from './useEventStream'

export type ArpPhase = 'loading' | 'live' | 'failed'

/**
 * Live ARP mirror: the `arp` events of the app's shared stream. The backend keeps its
 * router session only while at least one page holds the stream open. Rows stay on screen
 * while the stream is down or paused, until the next snapshot replaces them.
 */
export function useArp(stream: EventStream = useEventStream()) {
  const rows = shallowRef<ArpRows>(new Map())
  /** Replaced only when some object's presence changes, not on every NUD transition. */
  const presence = shallowRef<ArpPresenceIndex>(new Map())
  const mirrorState = ref<ArpMirrorState>('idle')
  const mirrorError = ref<string | null>(null)
  const streamFailed = computed(() => stream.state.value === 'error')
  const hasData = ref(false)

  const handle = (event: ArpEvent) => {
    if (event.type === 'status') {
      mirrorState.value = event.state
      mirrorError.value = event.error
      return
    }
    rows.value = applyArpEvent(rows.value, event)
    if (event.type === 'snapshot') hasData.value = true
    const next = indexArpPresence(rows.value.values())
    if (!samePresence(next, presence.value)) presence.value = next
  }

  onScopeDispose(stream.on<ArpEvent>('arp', handle))

  const phase = computed<ArpPhase>(() => {
    if (streamFailed.value || mirrorState.value === 'error') return 'failed'
    return hasData.value ? 'live' : 'loading'
  })

  const errorMessage = computed(() => {
    if (streamFailed.value) return 'The ARP stream of the status backend is unreachable.'
    if (mirrorState.value === 'error') return `The router session failed: ${mirrorError.value ?? 'unknown error'}.`
    return null
  })

  return {
    rows: readonly(rows),
    presence: readonly(presence),
    phase,
    hasData: readonly(hasData),
    errorMessage,
  }
}

export type ArpSource = ReturnType<typeof useArp>
