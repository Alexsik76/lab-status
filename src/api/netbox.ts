import { normalizeInventory } from '../domain/normalize'
import type { Inventory } from '../domain/model'
import type { GraphQLResponse, RawInventory } from '../types/netbox'
import { ApiError } from './errors'

const isInventory = (data: Partial<RawInventory>): data is RawInventory =>
  Array.isArray(data.device_list) &&
  Array.isArray(data.virtual_machine_list) &&
  Array.isArray(data.service_list)

/**
 * Validates a GraphQL body (the backend's `inventory` events carry its `data` object;
 * the query itself lives in backend/app/inventory.py) and returns the normalized inventory.
 */
export function parseInventoryResponse(body: GraphQLResponse<Partial<RawInventory>>): Inventory {
  if (body.errors?.length) {
    throw new ApiError('invalid', `NetBox rejected the query: ${body.errors.map((e) => e.message).join('; ')}`)
  }
  if (!body.data || !isInventory(body.data)) {
    throw new ApiError('invalid', 'NetBox returned an unexpected response (inventory data is missing).')
  }
  return normalizeInventory(body.data)
}
