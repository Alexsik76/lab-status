import { computed } from 'vue'
import { buildTree, countTree } from '../domain/tree'
import { useInventory } from './useInventory'
import { useStatuses } from './useStatuses'

export type LabView = 'loading' | 'fatal' | 'empty' | 'tree'

/**
 * The two independent sources combined: the tree is built as soon as the
 * inventory is available and re-derived when statuses arrive.
 */
export function useLab() {
  const inventory = useInventory()
  const statuses = useStatuses()

  const tree = computed(() => (inventory.data.value ? buildTree(inventory.data.value, statuses.index.value) : null))
  const counts = computed(() => (tree.value ? countTree(tree.value) : null))

  const view = computed<LabView>(() => {
    if (tree.value) {
      return tree.value.machines.length === 0 && tree.value.unplaced.length === 0 ? 'empty' : 'tree'
    }
    return inventory.errorMessage.value ? 'fatal' : 'loading'
  })

  return {
    view,
    tree,
    counts,
    statusPhase: statuses.phase,
    statusError: statuses.errorMessage,
    /** The inventory failed to refresh while an older tree is still shown. */
    refreshError: computed(() => (tree.value ? inventory.errorMessage.value : null)),
    /** Message of the failure that made the page unusable. */
    fatalError: computed(() => (tree.value ? null : inventory.errorMessage.value)),
    isRefreshing: computed(() => inventory.isLoading.value || statuses.isLoading.value),
    updatedAt: inventory.updatedAt,
    refresh: () => Promise.all([inventory.refresh(), statuses.refresh()]),
  }
}
