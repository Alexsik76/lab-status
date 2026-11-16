import { onScopeDispose, readonly, ref, type Ref } from 'vue'
import { STREAM_HIDDEN_CLOSE_MS, STREAM_URL } from '../config'

/**
 * - `idle`: no EventSource (not supported, or closed for good);
 * - `connecting` / `open`: as the browser reports it;
 * - `error`: the connection dropped, the browser is retrying by itself;
 * - `paused`: closed on purpose while the tab is hidden, reopened when it is shown again.
 */
export type StreamState = 'idle' | 'connecting' | 'open' | 'error' | 'paused'

export interface EventStream {
  readonly state: Readonly<Ref<StreamState>>
  /** Calls `handler` with the parsed JSON of every event named `event`; returns the unsubscribe. */
  on<T>(event: string, handler: (data: T) => void): () => void
  /** Closes the connection for good. */
  close(): void
}

export interface EventStreamOptions {
  url: string
  /** A tab hidden for longer than this closes the stream. */
  hiddenCloseMs?: number
  eventSource?: typeof EventSource
  doc?: Document
}

type Handler = (data: unknown) => void

/**
 * One Server-Sent Events connection, demultiplexed by the SSE `event:` field. Subscribers
 * keep their own data: closing (hidden tab) and reopening clears nothing, the backend
 * simply re-sends each source's current state on the new connection.
 */
export function createEventStream(options: EventStreamOptions): EventStream {
  const Source = options.eventSource ?? (typeof EventSource === 'undefined' ? undefined : EventSource)
  const doc = options.doc ?? (typeof document === 'undefined' ? undefined : document)
  const hiddenCloseMs = options.hiddenCloseMs ?? STREAM_HIDDEN_CLOSE_MS
  const state = ref<StreamState>('idle')
  const handlers = new Map<string, Set<Handler>>()
  let source: EventSource | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const dispatch = (event: string) => (message: Event) => {
    let data: unknown
    try {
      data = JSON.parse((message as MessageEvent<string>).data)
    } catch {
      return // A malformed event is dropped; the next snapshot restores consistency.
    }
    for (const handler of handlers.get(event) ?? []) {
      try {
        handler(data)
      } catch {
        // One subscriber's failure must not starve the others.
      }
    }
  }

  const listen = (es: EventSource, event: string) => es.addEventListener(event, dispatch(event))

  function open() {
    if (!Source || source || closed) return
    const es = new Source(options.url)
    source = es
    state.value = 'connecting'
    es.onopen = () => {
      state.value = 'open'
    }
    // EventSource reconnects by itself; meanwhile the subscribers keep their last data.
    es.onerror = () => {
      state.value = 'error'
    }
    for (const event of handlers.keys()) listen(es, event)
  }

  function pause() {
    hideTimer = null
    if (!source) return
    source.close()
    source = null
    state.value = 'paused'
  }

  function onVisibility() {
    if (!doc) return
    if (doc.visibilityState === 'hidden') {
      if (hideTimer === null && source) hideTimer = setTimeout(pause, hiddenCloseMs)
      return
    }
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
    if (state.value === 'paused') open()
  }

  doc?.addEventListener('visibilitychange', onVisibility)
  open()
  onVisibility()

  return {
    state: readonly(state),
    on<T>(event: string, handler: (data: T) => void) {
      let set = handlers.get(event)
      if (!set) {
        set = new Set()
        handlers.set(event, set)
        if (source) listen(source, event)
      }
      set.add(handler as Handler)
      return () => {
        set.delete(handler as Handler)
      }
    },
    close() {
      closed = true
      doc?.removeEventListener('visibilitychange', onVisibility)
      if (hideTimer !== null) clearTimeout(hideTimer)
      hideTimer = null
      source?.close()
      source = null
      state.value = 'idle'
    },
  }
}

let shared: { stream: EventStream; users: number } | null = null

/**
 * The app's single stream (`/api/stream`), shared by every composable that reads from it.
 * It opens with the first user and closes when the last user's scope is disposed.
 */
export function useEventStream(): EventStream {
  if (!shared) shared = { stream: createEventStream({ url: STREAM_URL }), users: 0 }
  const entry = shared
  entry.users += 1
  onScopeDispose(() => {
    entry.users -= 1
    if (entry.users === 0) {
      entry.stream.close()
      if (shared === entry) shared = null
    }
  })
  return entry.stream
}
