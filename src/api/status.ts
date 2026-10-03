import { STATUS_TIMEOUT_MS, STATUS_URL } from '../config'
import type { StatusEntry } from '../types/status'
import { ApiError } from './errors'
import { fetchJson } from './http'

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
  if (!Array.isArray(body) || !body.every(isStatusEntry)) {
    throw new ApiError('invalid', 'The status service returned an unexpected response.')
  }
  return body
}

export async function fetchStatuses(): Promise<StatusEntry[]> {
  const body = await fetchJson<unknown>(STATUS_URL, { source: 'The status service', timeoutMs: STATUS_TIMEOUT_MS })
  return parseStatusResponse(body)
}
