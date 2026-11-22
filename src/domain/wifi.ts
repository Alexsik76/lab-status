import type { WifiAp, WifiClient, WifiData, WifiNetwork, WifiRadio } from '../types/wifi'

/**
 * The Wi-Fi block as a grid: one column per access point, one row per network (SSID + band),
 * one cell where they meet. Pure; the Topology page renders it under the wired diagram.
 */

export type WifiCell =
  | { kind: 'none' }
  | { kind: 'disabled'; radio: WifiRadio }
  | { kind: 'radio'; radio: WifiRadio; clients: WifiClient[] }

export interface WifiRow {
  network: WifiNetwork
  /** One per column, in column order. */
  cells: WifiCell[]
}

export interface WifiGrid {
  columns: WifiAp[]
  rows: WifiRow[]
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/**
 * Columns: access points in the order of their cards on the wired diagram, left to right
 * (`positionOf` gives a card's x, or undefined), the rest after them by name.
 */
export function orderAccessPoints(aps: readonly WifiAp[], positionOf: (deviceId: string) => number | undefined): WifiAp[] {
  const x = (ap: WifiAp) => (ap.deviceId === null ? undefined : positionOf(ap.deviceId))
  return [...aps].sort((a, b) => {
    const xa = x(a)
    const xb = x(b)
    if (xa !== undefined && xb !== undefined && xa !== xb) return xa - xb
    if ((xa === undefined) !== (xb === undefined)) return xa === undefined ? 1 : -1
    return collator.compare(a.name, b.name)
  })
}

export function buildWifiGrid(
  data: WifiData,
  positionOf: (deviceId: string) => number | undefined = () => undefined,
): WifiGrid {
  const columns = orderAccessPoints(data.aps, positionOf)
  const sameRow = (n: WifiNetwork, x: { ssid: string; band: WifiNetwork['band'] }) => x.ssid === n.ssid && x.band === n.band
  const rows = data.networks.map((network): WifiRow => ({
    network,
    cells: columns.map((ap): WifiCell => {
      const radios = data.radios.filter((r) => r.apId === ap.id && sameRow(network, r))
      if (!radios.length) return { kind: 'none' }
      const live = radios.find((r) => r.state !== 'disabled')
      if (!live) return { kind: 'disabled', radio: radios[0] }
      const clients = data.clients
        .filter((c) => c.apId === ap.id && sameRow(network, c))
        .sort((a, b) => collator.compare(a.name, b.name))
      return { kind: 'radio', radio: live, clients }
    }),
  }))
  return { columns, rows }
}

/** The client chip's tooltip: MAC, IP, signal and uptime, as far as known. */
export function clientTooltip(client: WifiClient): string {
  return [
    client.mac,
    client.ip,
    client.signal !== null ? `${client.signal} dBm` : null,
    client.uptime ? `up ${client.uptime}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
