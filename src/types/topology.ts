/** The `topology` key of the backend's `inventory` payload (see backend/app/topology.py). */

export interface RawTopologyVlan {
  vid: number
  name: string
}

export interface RawTopologyPort {
  id: string
  deviceId: string
  name: string
  /** Index of the interface in NetBox's natural order within its device. */
  order: number
  /** NetBox interface type value, e.g. `1000base-t`. */
  type: string | null
  speedKbps: number | null
  /** `access`, `tagged`, `tagged-all`, or null when not set. */
  mode: string | null
  untagged: number | null
  tagged: number[]
  mgmtOnly: boolean
}

export interface RawTopologyCable {
  id: string
  type: string | null
  a: string
  b: string
}

export interface RawTopology {
  vlans: RawTopologyVlan[]
  ports: RawTopologyPort[]
  cables: RawTopologyCable[]
}
