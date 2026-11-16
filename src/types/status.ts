/** One service check result, as carried by the `services` events of the stream. */
export interface StatusEntry {
  name: string
  url: string
  up: boolean
  code: number | null
  error: string | null
  /** NetBox service id, or null for checks that are not tied to a NetBox service. */
  service_id: number | null
  /** Reverse-proxy (Nginx Proxy Manager) URL forwarding to this check's ip:port, if any. */
  public_url?: string | null
}
