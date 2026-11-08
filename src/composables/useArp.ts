import { computed, onScopeDispose, readonly, ref, shallowRef } from 'vue'
import { ARP_STREAM_URL } from '../config'
import { applyArpEvent, indexArpPresence, samePresence, type ArpPresenceIndex, type ArpRows } from '../domain/arp'
import type { ArpEvent, ArpMirrorState } from '../types/arp'

export type ArpPhase = 'loading' | 'live' | 'failed'

/**
 * Live ARP mirror over Server-Sent Events. The backend keeps its router session
 * only while at least one page holds this stream open; it is closed with the scope.
 */
export function useArp(url = ARP_STREAM_URL) {
  const rows = shallowRef<ArpRows>(new Map())
  /** Replaced only when some object's presence changes, not on every NUD transition. */
  const presence = shallowRef<ArpPresenceIndex>(new Map())
  const mirrorState = ref<ArpMirrorState>('idle')
  const mirrorError = ref<string | null>(null)
  const streamFailed = ref(false)
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

  let source: EventSource | null = null
  if (typeof EventSource !== 'undefined') {
    source = new EventSource(url)
    source.onopen = () => {
      streamFailed.value = false
    }
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        handle(JSON.parse(message.data) as ArpEvent)
      } catch {
        // A malformed event is dropped; the next snapshot restores consistency.
      }
    }
    // EventSource reconnects by itself; meanwhile the last rows stay on screen.
    source.onerror = () => {
      streamFailed.value = true
    }
  }

  onScopeDispose(() => source?.close())

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
