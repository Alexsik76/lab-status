import { computed, shallowRef } from 'vue'
import { useAsyncState, useDateFormat, useStorage } from '@vueuse/core'
import { fetchInventory } from '../api/netbox'
import { errorMessage } from '../api/errors'
import type { Inventory } from '../domain/model'

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
 * NetBox inventory. The last successfully loaded inventory is cached in local storage.
 * On open, the stored inventory is rendered immediately and replaced when the fresh one arrives.
 * If NetBox cannot be reached, the stored tree is kept and live sources load as usual.
 */
export function useInventory() {
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
  const updatedAt = shallowRef<Date | null>(initial ? new Date(initial.timestamp) : null)

  const { state, isLoading, error, execute } = useAsyncState<Inventory | null>(
    fetchInventory,
    initial ? initial.inventory : null,
    {
      shallow: true,
      resetOnExecute: false,
      onSuccess: (fresh) => {
        if (fresh) {
          const now = new Date()
          updatedAt.value = now
          stored.value = {
            version: INVENTORY_SCHEMA_VERSION,
            inventory: fresh,
            timestamp: now.toISOString(),
          }
        }
      },
    },
  )

  const inventoryTimeText = useDateFormat(() => updatedAt.value ?? undefined, 'ddd D MMM YYYY · HH:mm:ss')

  return {
    data: state,
    isLoading,
    updatedAt,
    inventoryTimeText,
    errorMessage: computed(() => (error.value ? errorMessage(error.value) : null)),
    refresh: () => execute(),
  }
}
