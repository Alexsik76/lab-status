import { CONTAINER_STATUS_TIMEOUT_MS, CONTAINER_STATUS_URL } from '../config'
import type { DockerContainerEntry } from '../types/containerStatus'
import { fetchLiveList, parseListResponse } from './status'

export const isDockerContainerEntry = (value: unknown): value is DockerContainerEntry => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.env === 'string' &&
    typeof v.name === 'string' &&
    typeof v.state === 'string' &&
    typeof v.status === 'string'
  )
}

export function parseContainerStatusResponse(body: unknown): DockerContainerEntry[] {
  return parseListResponse(body, isDockerContainerEntry, 'The container status service')
}

export async function fetchContainerStatuses(): Promise<DockerContainerEntry[]> {
  return fetchLiveList(
    CONTAINER_STATUS_URL,
    'The container status service',
    parseContainerStatusResponse,
    CONTAINER_STATUS_TIMEOUT_MS,
  )
}
