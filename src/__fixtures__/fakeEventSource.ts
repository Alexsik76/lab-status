/** Minimal EventSource double for tests: they drive open / error / named events by hand. */
export class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  /** 0 CONNECTING, 1 OPEN, 2 CLOSED. */
  readyState = 0
  private listeners = new Map<string, ((message: MessageEvent<string>) => void)[]>()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  static latest(): FakeEventSource {
    const last = FakeEventSource.instances.at(-1)
    if (!last) throw new Error('no EventSource was opened')
    return last
  }

  addEventListener(event: string, listener: (message: MessageEvent<string>) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  close() {
    this.closed = true
    this.readyState = 2
  }

  open() {
    this.readyState = 1
    this.onopen?.()
  }

  /** The browser's view of a failure: an HTTP error answer closes it for good, a network drop retries. */
  fail(gaveUp: boolean) {
    this.readyState = gaveUp ? 2 : 0
    this.onerror?.()
  }

  emit(event: string, data: unknown) {
    const message = { data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent<string>
    for (const listener of this.listeners.get(event) ?? []) listener(message)
  }
}
