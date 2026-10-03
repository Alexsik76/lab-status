/** Raw shapes of the NetBox GraphQL response (see `api/netbox.ts` for the query). */

export interface RawTag {
  name: string
  color?: string | null
}

export interface RawDevice {
  id: string
  name: string | null
  status: string | null
  role: { slug: string } | null
  device_type: { model: string; manufacturer: { name: string } | null } | null
  primary_ip4: { address: string } | null
  cluster: { name: string } | null
  platform: { name: string } | null
  tags?: RawTag[] | null
  custom_fields?: Record<string, unknown> | null
}

export interface RawVirtualMachine {
  id: string
  name: string | null
  status: string | null
  vcpus: string | null
  memory: number | null
  disk: number | null
  description: string | null
  virtual_machine_type: { name: string } | null
  cluster: { name: string } | null
  device: { id: string; name: string | null } | null
  platform: { name: string } | null
  primary_ip4: { address: string } | null
  tags: RawTag[] | null
  custom_fields: Record<string, unknown> | null
}

export interface RawService {
  id: string
  name: string | null
  ports: number[] | null
  custom_fields: Record<string, unknown> | null
  ipaddresses: { address: string }[] | null
  parent: { __typename: string; id?: string } | null
}

export interface RawInventory {
  device_list: RawDevice[]
  virtual_machine_list: RawVirtualMachine[]
  service_list: RawService[]
}

export interface GraphQLResponse<T> {
  data?: T | null
  errors?: { message: string }[]
}
