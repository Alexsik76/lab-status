/** Domain model: normalized inventory records and the rendered tree. */

export type State = 'up' | 'down' | 'stopped' | 'unknown'

/** Statuses a single service check can resolve to. */
export type ServiceState = Exclude<State, 'stopped'>

export type VmKind = 'KVM' | 'LXC' | 'Docker' | 'other'

export interface TagItem {
  name: string
  color: string | null
}

export interface DeviceHardware {
  cpuCores: number | null
  memoryGb: number | null
  storageGb: number | null
}

// ---- Normalized inventory (flat records, output of `normalizeInventory`) ----

export interface DeviceRecord {
  id: string
  name: string
  roleSlug: string | null
  offline: boolean
  model: string | null
  manufacturer: string | null
  ip: string | null
  cluster: string | null
  platform: string | null
  tags: TagItem[]
  hardware: DeviceHardware
}

export interface VmRecord {
  id: string
  name: string
  alias: string | null
  kind: VmKind
  offline: boolean
  vcpus: number | null
  memoryMb: number | null
  /** Disk size as stored in NetBox (unit follows the NetBox version, typically MiB). */
  disk: number | null
  description: string
  image: string | null
  /** Stack name from the `stack:<name>` tag; null when standalone or untagged. */
  stack: string | null
  cluster: string | null
  platform: string | null
  ip: string | null
  tags: TagItem[]
  /** Id of the device the VM runs on (NetBox `device`). */
  deviceId: string | null
  /** Id of the guest VM that hosts this container (custom field `host`). */
  hostId: string | null
}

export interface ServiceRecord {
  id: string
  name: string
  ports: number[]
  scheme: string | null
  addresses: string[]
  parent: { kind: 'vm' | 'device'; id: string } | null
}

export interface Inventory {
  devices: DeviceRecord[]
  vms: VmRecord[]
  services: ServiceRecord[]
}

// ---- Tree (output of `buildTree`) ----

export interface ServiceItem {
  id: string
  name: string
  ports: number[]
  scheme: string | null
  addresses: string[]
  /** Link target: the url of the matching status entry. */
  url: string | null
  state: ServiceState
  httpCode: number | null
  error: string | null
}

interface NodeBase {
  id: string
  name: string
  state: State
  services: ServiceItem[]
}

export interface Container extends NodeBase {
  image: string | null
  stack: string | null
  tags: TagItem[]
  blinking?: boolean
  dockerStatus?: string | null
}

export interface Stack {
  name: string
  state: State
  containers: Container[]
}

export interface Guest extends NodeBase {
  kind: 'KVM' | 'LXC'
  vcpus: number | null
  memoryMb: number | null
  disk: number | null
  ip: string | null
  platform: string | null
  cluster: string | null
  tags: TagItem[]
  stacks: Stack[]
  /** Containers without a stack. */
  standalone: Container[]
}

export interface Machine extends NodeBase {
  model: string | null
  manufacturer: string | null
  ip: string | null
  platform: string | null
  cluster: string | null
  tags: TagItem[]
  hardware: DeviceHardware
  guests: Guest[]
  /** Docker workloads attached straight to the machine. */
  apps: Container[]
}

export interface LabTree {
  machines: Machine[]
  /** Docker workloads whose host could not be resolved. */
  unplaced: Container[]
}

export interface TreeCounts {
  machines: number
  guests: number
  stoppedGuests: number
  containers: number
}
