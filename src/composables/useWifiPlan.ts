import type { Ref } from 'vue'
import { mergePlan } from '../domain/wifiGraph'
import type { WifiData } from '../types/wifi'
import { RELAYOUT_MS, useThrottledPlan } from './useThrottledPlan'

/** Structural Wi-Fi changes reach the layout at most once per this interval. */
export const WIFI_RELAYOUT_MS = RELAYOUT_MS

/** The Wi-Fi plan the diagram is laid out from (see `mergePlan` and `useThrottledPlan`). */
export function useWifiPlan(wifi: Readonly<Ref<WifiData | null | undefined>>, now: () => number = Date.now) {
  return useThrottledPlan(wifi, mergePlan, now)
}
