/** The `wifi` stream source (backend/app/wifi.py): the router's CAPsMAN, read on a poll. */

export type WifiBand = '2.4' | '5'

export interface WifiNetwork {
  ssid: string
  band: WifiBand | null
  vlan: number | null
}

export interface WifiAp {
  /** The CAP's name in CAPsMAN (stable per access point). */
  id: string
  name: string
  /** The NetBox device of the access point, when matched. */
  deviceId: string | null
}

export interface WifiRadio {
  apId: string
  ssid: string
  band: WifiBand | null
  /** Frequency in MHz. */
  channel: number | null
  state: 'running' | 'disabled' | 'down'
}

export interface WifiClient {
  apId: string
  ssid: string
  band: WifiBand | null
  mac: string
  name: string
  deviceId: string | null
  ip: string | null
  /** dBm. */
  signal: number | null
  uptime: string | null
}

export interface WifiData {
  networks: WifiNetwork[]
  aps: WifiAp[]
  radios: WifiRadio[]
  clients: WifiClient[]
}
