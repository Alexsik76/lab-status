import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { fetchProxmoxData } from '../api/proxmox'
import type { ProxmoxData } from '../types/proxmox'
import { useLiveSource } from './useLiveSource'

/**
 * Live Proxmox cluster resources and machine load metrics.
 * Loads on mount / manual refresh, and refreshes every 30 seconds only while visible.
 */
export function useProxmox() {
  const source = useLiveSource<ProxmoxData>({
    fetcher: fetchProxmoxData,
  })

  const visibility = useDocumentVisibility()

  useIntervalFn(() => {
    if (visibility.value === 'visible') {
      source.refresh()
    }
  }, 30_000)

  return source
}
