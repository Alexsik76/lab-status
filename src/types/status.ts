/** One entry of the n8n `service-status` response. */
export interface StatusEntry {
  name: string
  url: string
  up: boolean
  code: number | null
  error: string | null
  /** NetBox service id, or null for checks that are not tied to a NetBox service. */
  service_id: number | null
}
