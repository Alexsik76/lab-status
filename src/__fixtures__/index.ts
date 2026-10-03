import type { GraphQLResponse, RawInventory } from '../types/netbox'
import type { StatusEntry } from '../types/status'
import netboxBody from './netbox.json'
import statusBody from './status.json'

/** Responses captured from the real NetBox GraphQL endpoint and the n8n status webhook. */
export const netboxResponse = netboxBody as unknown as GraphQLResponse<RawInventory>
export const rawInventory = netboxResponse.data as RawInventory
export const statusEntries = statusBody as StatusEntry[]
