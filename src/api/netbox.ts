import { INVENTORY_TIMEOUT_MS, NETBOX_GRAPHQL_URL } from '../config'
import { normalizeInventory } from '../domain/normalize'
import type { Inventory } from '../domain/model'
import type { GraphQLResponse, RawInventory } from '../types/netbox'
import { ApiError } from './errors'
import { fetchJson } from './http'

export const INVENTORY_QUERY = `{
  device_list { id name status role { slug } device_type { model manufacturer { name } }
    primary_ip4 { address } cluster { name } platform { name } }
  virtual_machine_list { id name status vcpus memory disk description
    virtual_machine_type { name } cluster { name } device { id name } platform { name }
    primary_ip4 { address } tags { name } custom_fields }
  service_list { id name ports custom_fields ipaddresses { address }
    parent { __typename ... on VirtualMachineType { id } ... on DeviceType { id } } }
}`

const isInventory = (data: Partial<RawInventory>): data is RawInventory =>
  Array.isArray(data.device_list) &&
  Array.isArray(data.virtual_machine_list) &&
  Array.isArray(data.service_list)

/** Validates a GraphQL body and returns the normalized inventory. */
export function parseInventoryResponse(body: GraphQLResponse<Partial<RawInventory>>): Inventory {
  if (body.errors?.length) {
    throw new ApiError('invalid', `NetBox rejected the query: ${body.errors.map((e) => e.message).join('; ')}`)
  }
  if (!body.data || !isInventory(body.data)) {
    throw new ApiError('invalid', 'NetBox returned an unexpected response (inventory data is missing).')
  }
  return normalizeInventory(body.data)
}

export async function fetchInventory(): Promise<Inventory> {
  const body = await fetchJson<GraphQLResponse<Partial<RawInventory>>>(NETBOX_GRAPHQL_URL, {
    source: 'NetBox',
    timeoutMs: INVENTORY_TIMEOUT_MS,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: INVENTORY_QUERY }),
    },
  })
  return parseInventoryResponse(body)
}
