import { computed, shallowRef } from 'vue'
import { useAsyncState } from '@vueuse/core'
import { fetchInventory } from '../api/netbox'
import { errorMessage } from '../api/errors'
import type { Inventory } from '../domain/model'

/**
 * NetBox inventory. The previous inventory is kept while a refresh is running or
 * after a refresh failed, so the tree never disappears once it has been shown.
 */
export function useInventory() {
  const updatedAt = shallowRef<Date | null>(null)

  const { state, isLoading, error, execute } = useAsyncState<Inventory | null>(fetchInventory, null, {
    shallow: true,
    resetOnExecute: false,
    onSuccess: () => {
      updatedAt.value = new Date()
    },
  })

  return {
    data: state,
    isLoading,
    updatedAt,
    errorMessage: computed(() => (error.value ? errorMessage(error.value) : null)),
    refresh: () => execute(),
  }
}
