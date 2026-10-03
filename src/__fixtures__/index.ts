import type { DockerContainerEntry } from '../types/containerStatus'
import type { GraphQLResponse, RawInventory } from '../types/netbox'
import type { StatusEntry } from '../types/status'
import containerStatusBody from './containerStatus.json'
import netboxBody from './netbox.json'
import statusBody from './status.json'

/** Responses captured from the real NetBox GraphQL endpoint and the n8n webhooks. */
export const netboxResponse = netboxBody as unknown as GraphQLResponse<RawInventory>
export const rawInventory = netboxResponse.data as RawInventory
export const statusEntries = statusBody as StatusEntry[]
export const containerStatusEntries = containerStatusBody as DockerContainerEntry[]
