import { computed, onScopeDispose, readonly, shallowRef } from 'vue'
import { useDateFormat, useStorage } from '@vueuse/core'
import { errorMessage } from '../api/errors'
import { parseInventoryResponse } from '../api/netbox'
import { requestRefresh } from '../api/refresh'
import type { Inventory } from '../domain/model'
import type { RawInventory } from '../types/netbox'
import type { PolledEvent, SourceStatus } from '../types/stream'
import { useEventStream, type EventStream } from './useEventStream'

export const INVENTORY_STORAGE_KEY = 'lab-status:inventory'
export const INVENTORY_SCHEMA_VERSION = 1

export interface StoredInventory {
  version: number
  inventory: Inventory
  timestamp: string
}

export function isValidInventory(raw: unknown): raw is Inventory {
  if (!raw || typeof raw !== 'object') return false
  const inv = raw as Partial<Inventory>
  return Array.isArray(inv.devices) && Array.isArray(inv.vms) && Array.isArray(inv.services)
}

export function isValidStoredInventory(raw: unknown): raw is StoredInventory {
  if (!raw || typeof raw !== 'object') return false
  const item = raw as Partial<StoredInventory>
  return (
    item.version === INVENTORY_SCHEMA_VERSION &&
    typeof item.timestamp === 'string' &&
    isValidInventory(item.inventory)
  )
}

/**
 * NetBox inventory, read by the backend (`inventory` events of the shared stream: the GraphQL
 * `data` object, normalized here). The last successfully loaded inventory is cached in local
 * storage: on open it is rendered immediately and replaced when the fresh one arrives; while
 * the backend cannot reach NetBox (or the stream is down), the stored tree is kept.
 * `updatedAt` is the backend's time of the last successful NetBox read.
 */
export function useInventory(stream: EventStream = useEventStream()) {
  const stored = useStorage<StoredInventory | null>(
    INVENTORY_STORAGE_KEY,
    null,
    undefined,
    {
      serializer: {
        read: (raw: string) => {
          try {
            const parsed = JSON.parse(raw)
            return isValidStoredInventory(parsed) ? parsed : null
          } catch {
            return null
          }
        },
        write: (val: StoredInventory | null) => JSON.stringify(val),
      },
      onError: () => {},
    },
  )

  const initial = isValidStoredInventory(stored.value) ? stored.value : null
  const state = shallowRef<Inventory | null>(initial ? initial.inventory : null)
  const updatedAt = shallowRef<Date | null>(initial ? new Date(initial.timestamp) : null)
  const status = shallowRef<SourceStatus | null>(null)
  const parseError = shallowRef<string | null>(null)

  const persist = () => {
    if (!state.value) return
    stored.value = {
      version: INVENTORY_SCHEMA_VERSION,
      inventory: state.value,
      timestamp: (updatedAt.value ?? new Date()).toISOString(),
    }
  }

  onScopeDispose(
    stream.on<PolledEvent<Partial<RawInventory>>>('inventory', (event) => {
      if (event.type === 'status') {
        status.value = event
        // Only a new time is stored: a status that repeats it (or only changes the state or
        // the error) leaves the stored inventory as it is.
        if (event.updatedAt && state.value) {
          const at = new Date(event.updatedAt)
          if (at.getTime() === updatedAt.value?.getTime()) return
          updatedAt.value = at
          persist()
        }
        return
      }
      try {
        state.value = parseInventoryResponse({ data: event.data })
        parseError.value = null
        // A new subscriber gets the status before the data: its time belongs to this data.
        const at = status.value?.updatedAt
        updatedAt.value = at ? new Date(at) : new Date()
        persist()
      } catch (err) {
        parseError.value = errorMessage(err)
      }
    }),
  )

  const inventoryTimeText = useDateFormat(() => updatedAt.value ?? undefined, 'ddd D MMM YYYY · HH:mm:ss')

  const message = computed(() => {
    if (parseError.value) return parseError.value
    if (status.value?.state === 'error') return status.value.error ?? 'NetBox could not be read.'
    if (!state.value && stream.state.value === 'error') return 'The status backend stream is unreachable.'
    return null
  })

  return {
    data: computed(() => state.value),
    isLoading: computed(() => !state.value && !message.value),
    updatedAt: computed(() => updatedAt.value),
    inventoryTimeText,
    errorMessage: message,
    status: readonly(status),
    /** The backend re-reads NetBox and NPM at once; the result arrives over the stream. */
    refresh: () => requestRefresh(),
  }
}
