import { onScopeDispose } from 'vue'

/** How long the highlight stays, and how long to wait for the target to appear. */
export const FOCUS_HIGHLIGHT_MS = 1600
export const FOCUS_WAIT_MS = 5000

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * Scrolls the element `[data-focus-device="<id>"]` into view (centred) and marks it with
 * `data-focus-flash` for `FOCUS_HIGHLIGHT_MS`; then calls `clear(id)`. The target may appear
 * later (a layout still running): it is waited for up to `FOCUS_WAIT_MS`. An id that never
 * appears is ignored silently (and cleared). A newer `show` cancels the previous one.
 * An attribute, not a class: Vue re-renders the class but leaves foreign attributes alone.
 */
export function useFocusTarget(options: { clear: (id: string) => void; root?: () => ParentNode }) {
  let run = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
  }
  onScopeDispose(() => {
    for (const t of timers) clearTimeout(t)
  })

  const find = (id: string) =>
    (options.root?.() ?? document).querySelector<HTMLElement>(`[data-focus-device="${CSS.escape(id)}"]`)

  function show(id: string) {
    const current = ++run
    const started = Date.now()
    const attempt = () => {
      if (current !== run) return
      const el = find(id)
      if (!el) {
        if (Date.now() - started < FOCUS_WAIT_MS) later(attempt, 50)
        else options.clear(id)
        return
      }
      const reduced = reducedMotion()
      el.scrollIntoView?.({ block: 'center', inline: 'center', behavior: reduced ? 'auto' : 'smooth' })
      el.setAttribute('data-focus-flash', '')
      later(() => {
        el.removeAttribute('data-focus-flash')
        if (current === run) options.clear(id)
      }, FOCUS_HIGHLIGHT_MS)
    }
    attempt()
  }

  return { show }
}
