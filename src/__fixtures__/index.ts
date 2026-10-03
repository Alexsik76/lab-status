import type { DockerContainerEntry } from '../types/containerStatus'
import type { GraphQLResponse, RawInventory } from '../types/netbox'
import type { ProxmoxResourceItem, ProxmoxRrdPoint } from '../types/proxmox'
import type { StatusEntry } from '../types/status'
import containerStatusBody from './containerStatus.json'
import netboxBody from './netbox.json'
import proxmoxResourcesBody from './proxmoxResources.json'
import proxmoxRrdBody from './proxmoxRrd.json'
import statusBody from './status.json'

/** Responses captured from the real NetBox GraphQL endpoint, n8n webhooks, and Proxmox. */
export const netboxResponse = netboxBody as unknown as GraphQLResponse<RawInventory>
export const rawInventory = netboxResponse.data as RawInventory
export const statusEntries = statusBody as StatusEntry[]
export const containerStatusEntries = containerStatusBody as DockerContainerEntry[]
export const proxmoxResources = (proxmoxResourcesBody as { data: ProxmoxResourceItem[] }).data
export const proxmoxRrdPoints = (proxmoxRrdBody as { data: ProxmoxRrdPoint[] }).data
