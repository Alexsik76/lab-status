import { STATUS_TIMEOUT_MS, STATUS_URL } from '../config'
import type { StatusEntry } from '../types/status'
import { ApiError } from './errors'
import { fetchJson } from './http'

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

export async function fetchLiveList<T>(
  url: string,
  sourceName: string,
  parse: (body: unknown) => T[],
  timeoutMs: number,
): Promise<T[]> {
  const body = await fetchJson<unknown>(url, { source: sourceName, timeoutMs })
  return parse(body)
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

/** Validates the webhook body; a malformed payload is treated as a failure, not as "no statuses". */
export function parseStatusResponse(body: unknown): StatusEntry[] {
  return parseListResponse(body, isStatusEntry, 'The status service')
}

export async function fetchStatuses(): Promise<StatusEntry[]> {
  return fetchLiveList(STATUS_URL, 'The status service', parseStatusResponse, STATUS_TIMEOUT_MS)
}
