import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import { wifiPayload } from '../__fixtures__/wifi'
import { planKey } from '../domain/wifiGraph'
import type { WifiData } from '../types/wifi'
import { WIFI_RELAYOUT_MS, useWifiPlan } from './useWifiPlan'

const client = (mac: string, name: string, apId = '[02:AA:00:00:00:01]') => ({
  ...wifiPayload.clients[0],
  mac,
  name,
  apId,
})

describe('useWifiPlan', () => {
  let now = 0
  beforeEach(() => {
    vi.useFakeTimers()
    now = 1_000_000
  })
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    const wifi = shallowRef<WifiData | null>(wifiPayload)
    const scope = effectScope()
    const { plan } = scope.run(() => useWifiPlan(wifi, () => now))!
    return { wifi, plan, scope }
  }
  const tick = async (ms: number) => {
    now += ms
    vi.advanceTimersByTime(ms)
    await nextTick()
  }

  it('lays out the first snapshot at once', () => {
    const { plan } = setup()
    expect(plan.value?.clients.map((c) => c.name)).toEqual(['plug-kitchen', 'bulb-hall', 'node-alpha'])
  })

  it('keeps a client that disconnects, without a relayout', async () => {
    const { wifi, plan } = setup()
    const before = planKey(plan.value)
    wifi.value = { ...wifiPayload, clients: wifiPayload.clients.slice(1) }
    await nextTick()
    expect(planKey(plan.value)).toBe(before)
    expect(plan.value?.clients.some((c) => c.name === 'plug-kitchen')).toBe(true)
  })

  it('never relays out for a channel, signal or radio state change', async () => {
    const { wifi, plan } = setup()
    const before = planKey(plan.value)
    wifi.value = {
      ...wifiPayload,
      radios: wifiPayload.radios.map((r) => ({ ...r, channel: 5500, state: 'down' as const })),
      clients: wifiPayload.clients.map((c) => ({ ...c, signal: -88 })),
    }
    await nextTick()
    expect(planKey(plan.value)).toBe(before)
  })

  it('collects structural changes within 10 s and applies them together', async () => {
    const { wifi, plan } = setup() // the first layout counts as a structural change at t0
    const seen: string[] = []
    const record = () => seen.push(planKey(plan.value))

    await tick(2_000)
    wifi.value = { ...wifiPayload, clients: [...wifiPayload.clients, client('02:BB:00:00:00:21', 'joiner-1')] }
    await nextTick()
    record()
    expect(plan.value?.clients.some((c) => c.name === 'joiner-1')).toBe(false) // not yet

    await tick(3_000)
    wifi.value = {
      ...wifiPayload,
      clients: [...wifiPayload.clients, client('02:BB:00:00:00:21', 'joiner-1'), client('02:BB:00:00:00:22', 'joiner-2', '[02:AA:00:00:00:02]')],
    }
    await nextTick()
    record()
    expect(seen[0]).toBe(seen[1]) // still collecting

    await tick(WIFI_RELAYOUT_MS - 5_000) // 10 s after the first layout
    expect(plan.value?.clients.map((c) => c.name)).toEqual(expect.arrayContaining(['joiner-1', 'joiner-2']))

    // The next structural change waits again for 10 s after this one.
    wifi.value = { ...wifi.value!, clients: [...wifi.value!.clients, client('02:BB:00:00:00:23', 'joiner-3')] }
    await nextTick()
    expect(plan.value?.clients.some((c) => c.name === 'joiner-3')).toBe(false)
    await tick(WIFI_RELAYOUT_MS)
    expect(plan.value?.clients.some((c) => c.name === 'joiner-3')).toBe(true)
  })

  it('applies a structural change at once when the last one is older than 10 s', async () => {
    const { wifi, plan } = setup()
    await tick(WIFI_RELAYOUT_MS + 1)
    wifi.value = { ...wifiPayload, clients: [...wifiPayload.clients, client('02:BB:00:00:00:31', 'late')] }
    await nextTick()
    expect(plan.value?.clients.some((c) => c.name === 'late')).toBe(true)
  })
})
