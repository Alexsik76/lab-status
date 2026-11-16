import type { StatusEntry } from '../types/status'
import { ApiError } from './errors'

export function parseListResponse<T>(
  body: unknown,
  isItem: (v: unknown) => v is T,
  serviceName: string,
): T[] {
  if (!Array.isArray(body) || !body.every(isItem)) {
    throw new ApiError('invalid', `${serviceName} returned an unexpected response.`)
  }
  return body
}

const isStatusEntry = (value: unknown): value is StatusEntry => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.name === 'string' &&
    typeof v.up === 'boolean' &&
    (v.service_id === null || typeof v.service_id === 'number')
  )
}

/** Validates a `services` event payload; a malformed one is a failure, not "no statuses". */
export function parseStatusResponse(body: unknown): StatusEntry[] {
  return parseListResponse(body, isStatusEntry, 'The service check source')
}
