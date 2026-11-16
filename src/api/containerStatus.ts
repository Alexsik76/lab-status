import type { DockerContainerEntry } from '../types/containerStatus'
import { parseListResponse } from './status'

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

/** Validates the payload of a `containers` event of the backend stream. */
export function parseContainerStatusResponse(body: unknown): DockerContainerEntry[] {
  return parseListResponse(body, isDockerContainerEntry, 'The container state source')
}
