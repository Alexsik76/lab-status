import { computed } from 'vue'
import { matchDockerContainers } from '../domain/containerStatuses'
import { buildTree, countTree } from '../domain/tree'
import { useContainerStatuses } from './useContainerStatuses'
import { useInventory } from './useInventory'
import { useStatuses, type StatusPhase } from './useStatuses'

export type LabView = 'loading' | 'fatal' | 'empty' | 'tree'

/**
 * The three independent sources combined: the tree is built as soon as the
 * inventory is available and re-derived when statuses or container states arrive.
 */
export function useLab() {
  const inventory = useInventory()
  const statuses = useStatuses()
  const containerStatuses = useContainerStatuses()

  const dockerIndex = computed(() =>
    inventory.data.value && containerStatuses.data.value
      ? matchDockerContainers(containerStatuses.data.value, inventory.data.value)
      : new Map(),
  )

  const tree = computed(() =>
    inventory.data.value
      ? buildTree(inventory.data.value, statuses.index.value, dockerIndex.value)
      : null,
  )
  const counts = computed(() => (tree.value ? countTree(tree.value) : null))

  const view = computed<LabView>(() => {
    if (tree.value) {
      return tree.value.machines.length === 0 && tree.value.unplaced.length === 0 ? 'empty' : 'tree'
    }
    return inventory.errorMessage.value ? 'fatal' : 'loading'
  })

  const livePhase = computed<StatusPhase>(() => {
    if (statuses.phase.value === 'loading' || containerStatuses.phase.value === 'loading') {
      return 'loading'
    }
    if (statuses.phase.value === 'failed' && containerStatuses.phase.value === 'failed') {
      return 'failed'
    }
    return 'ready'
  })

  return {
    view,
    tree,
    counts,
    livePhase,
    statusPhase: statuses.phase,
    statusError: statuses.errorMessage,
    containerStatusPhase: containerStatuses.phase,
    containerStatusError: containerStatuses.errorMessage,
    /** The inventory failed to refresh while an older tree is still shown. */
    refreshError: computed(() => (tree.value ? inventory.errorMessage.value : null)),
    /** Message of the failure that made the page unusable. */
    fatalError: computed(() => (tree.value ? null : inventory.errorMessage.value)),
    isRefreshing: computed(
      () => inventory.isLoading.value || statuses.isLoading.value || containerStatuses.isLoading.value,
    ),
    updatedAt: inventory.updatedAt,
    refresh: () => Promise.all([inventory.refresh(), statuses.refresh(), containerStatuses.refresh()]),
  }
}
