import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import { mergePlan, type WifiPlan } from '../domain/wifiGraph'
import type { WifiData } from '../types/wifi'

/** Structural Wi-Fi changes reach the layout at most once per this interval. */
export const WIFI_RELAYOUT_MS = 10_000

/**
 * The Wi-Fi plan the diagram is laid out from (see `mergePlan`). Non-structural updates (names,
 * addresses) apply at once; structural ones (a new client, a client on another radio, radios
 * added or removed) apply at once when the last structural change is at least
 * `WIFI_RELAYOUT_MS` old, else together when that interval has passed.
 */
export function useWifiPlan(wifi: Readonly<Ref<WifiData | null | undefined>>, now: () => number = Date.now) {
  const plan = shallowRef<WifiPlan | null>(null)
  let lastStructural = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | null = null

  const applyLatest = () => {
    timer = null
    const data = wifi.value
    if (!data) return
    const { next, structural } = mergePlan(plan.value, data)
    plan.value = next
    if (structural) lastStructural = now()
  }

  watch(
    wifi,
    (data) => {
      if (!data) return
      const { next, structural } = mergePlan(plan.value, data)
      if (!structural) {
        if (timer === null) plan.value = next
        return
      }
      if (timer !== null) return // already collecting; the timer applies the latest data
      const wait = lastStructural + WIFI_RELAYOUT_MS - now()
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
