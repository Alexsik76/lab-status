import {
  PROXMOX_CLUSTER_RESOURCES_URL,
  PROXMOX_NODES_URL,
  PROXMOX_TIMEOUT_MS,
} from '../config'
import type {
  ProxmoxData,
  ProxmoxNodeResource,
  ProxmoxResourcesResponse,
  ProxmoxRrdPoint,
  ProxmoxRrdResponse,
} from '../types/proxmox'
import { ApiError } from './errors'
import { fetchJson } from './http'

export function parseResourcesResponse(body: unknown): ProxmoxResourcesResponse {
  if (typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data)) {
    throw new ApiError('invalid', 'Proxmox returned an unexpected cluster resources response.')
  }
  return body as ProxmoxResourcesResponse
}

export function parseRrdResponse(body: unknown): ProxmoxRrdResponse {
  if (typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data)) {
    throw new ApiError('invalid', 'Proxmox returned an unexpected node rrddata response.')
  }
  return body as ProxmoxRrdResponse
}

export async function fetchClusterResources(): Promise<ProxmoxResourcesResponse> {
  const body = await fetchJson<unknown>(PROXMOX_CLUSTER_RESOURCES_URL, {
    source: 'Proxmox',
    timeoutMs: PROXMOX_TIMEOUT_MS,
  })
  return parseResourcesResponse(body)
}

export async function fetchNodeRrddata(node: string): Promise<ProxmoxRrdPoint[]> {
  const url = `${PROXMOX_NODES_URL}/${encodeURIComponent(node)}/rrddata?timeframe=hour&cf=AVERAGE`
  try {
    const body = await fetchJson<unknown>(url, {
      source: 'Proxmox',
      timeoutMs: PROXMOX_TIMEOUT_MS,
    })
    return parseRrdResponse(body).data
  } catch (err) {
    // If a single node's rrddata fails, log and fallback to empty points
    return []
  }
}

export async function fetchProxmoxData(): Promise<ProxmoxData> {
  const resourcesRes = await fetchClusterResources()
  const resources = resourcesRes.data

  const nodes = resources.filter(
    (item): item is ProxmoxNodeResource => item.type === 'node' && typeof (item as ProxmoxNodeResource).node === 'string',
  )

  const rrdEntries = await Promise.all(
    nodes.map(async (n) => {
      const points = await fetchNodeRrddata(n.node)
      return [n.node, points] as const
    }),
  )

  const rrdByNode: Record<string, ProxmoxRrdPoint[]> = {}
  for (const [node, points] of rrdEntries) {
    rrdByNode[node] = points
  }

  return { resources, rrdByNode }
}
