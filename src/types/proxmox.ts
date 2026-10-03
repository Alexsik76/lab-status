export interface ProxmoxNodeResource {
  type: 'node'
  node: string
  status: string
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
  uptime?: number
}

export interface ProxmoxGuestResource {
  type: 'qemu' | 'lxc'
  vmid: number
  name: string
  node: string
  status: 'running' | 'stopped' | string
  cpu: number
  mem: number
  maxmem: number
  uptime?: number
  template?: number
}

export type ProxmoxResourceItem =
  | ProxmoxNodeResource
  | ProxmoxGuestResource
  | { type: string; [key: string]: unknown }

export interface ProxmoxRrdPoint {
  time: number
  cpu?: number | null
  memused?: number | null
  memtotal?: number | null
  maxcpu?: number | null
}

export interface ProxmoxResourcesResponse {
  data: ProxmoxResourceItem[]
}

export interface ProxmoxRrdResponse {
  data: ProxmoxRrdPoint[]
}

export interface ProxmoxData {
  resources: ProxmoxResourceItem[]
  rrdByNode: Record<string, ProxmoxRrdPoint[]>
}
