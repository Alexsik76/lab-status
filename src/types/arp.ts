/** Presence derived by the backend from the router's ARP status. */
export type ArpPresence = 'active' | 'disconnected' | 'unknown'

/** NetBox object owning the MAC of an ARP entry. */
export interface ArpNetboxMatch {
  kind: 'device' | 'vm'
  id: string
  name: string
  role: string | null
  status: string | null
  interface: string | null
  /** Link to the object in the NetBox UI, when the backend knows the public NetBox URL. */
  url: string | null
}

/** One row of the router's ARP table, as mirrored by the backend. */
export interface ArpRow {
  id: string
  address: string
  mac: string
  interface: string
  /** Raw RouterOS status: reachable, stale, delay, probe, permanent, failed, incomplete, ... */
  status: string
  presence: ArpPresence
  dhcp: boolean
  dynamic: boolean
  disabled: boolean
  netbox: ArpNetboxMatch | null
}

export type ArpMirrorState = 'idle' | 'connecting' | 'live' | 'error'

/** Events of the `/api/arp/stream` Server-Sent Events channel. */
export type ArpEvent =
  | { type: 'status'; state: ArpMirrorState; error: string | null }
  | { type: 'snapshot'; rows: ArpRow[] }
  | { type: 'upsert'; row: ArpRow }
  | { type: 'remove'; id: string }
