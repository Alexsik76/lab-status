import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'

/** Structural changes reach the layout at most once per this interval. */
export const RELAYOUT_MS = 10_000

/**
 * A layout plan that follows live data. `merge(prev, data)` gives the next plan and whether it
 * changes the layout. Non-structural updates apply at once; structural ones apply at once when
 * the last structural change is at least `RELAYOUT_MS` old, else together when that interval
 * has passed (the latest data then).
 */
export function useThrottledPlan<D, P>(
  source: Readonly<Ref<D | null | undefined>>,
  merge: (prev: P | null, data: D) => { next: P; structural: boolean },
  now: () => number = Date.now,
) {
  const plan = shallowRef<P | null>(null)
  let lastStructural = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | null = null

  const applyLatest = () => {
    timer = null
    const data = source.value
    if (!data) return
    const { next, structural } = merge(plan.value, data)
    plan.value = next
    if (structural) lastStructural = now()
  }

  watch(
    source,
    (data) => {
      if (!data) return
      const { next, structural } = merge(plan.value, data)
      if (!structural) {
        if (timer === null) plan.value = next
        return
      }
      if (timer !== null) return // already collecting; the timer applies the latest data
      const wait = lastStructural + RELAYOUT_MS - now()
      if (wait <= 0) {
        plan.value = next
        lastStructural = now()
      } else {
        timer = setTimeout(applyLatest, wait)
      }
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    if (timer !== null) clearTimeout(timer)
  })

  return { plan }
}
