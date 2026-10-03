import { computed, readonly, ref } from 'vue'
import { matchDockerContainers } from '../domain/containerStatuses'
import { mapMachineMetrics, matchProxmoxGuests } from '../domain/proxmox'
import { buildTree, countTree } from '../domain/tree'
import { useContainerStatuses } from './useContainerStatuses'
import { useInventory } from './useInventory'
import { useProxmox } from './useProxmox'
import { useStatuses, type StatusPhase } from './useStatuses'

export type LabView = 'loading' | 'fatal' | 'empty' | 'tree'

/**
 * The four independent sources combined: the tree is built as soon as the
 * inventory is available and re-derived when statuses, container states, or
 * Proxmox guest states / machine metrics arrive.
 */
export function useLab() {
  const inventory = useInventory()
  const statuses = useStatuses()
  const containerStatuses = useContainerStatuses()
  const proxmox = useProxmox()

  const dockerIndex = computed(() =>
    inventory.data.value && containerStatuses.data.value
      ? matchDockerContainers(containerStatuses.data.value, inventory.data.value)
      : new Map(),
  )

  const proxmoxGuests = computed(() =>
    inventory.data.value && proxmox.data.value
      ? matchProxmoxGuests(proxmox.data.value.resources, inventory.data.value)
      : new Map(),
  )

  const machineMetrics = computed(() =>
    proxmox.data.value
      ? mapMachineMetrics(proxmox.data.value.resources, proxmox.data.value.rrdByNode)
      : new Map(),
  )

  const tree = computed(() =>
    inventory.data.value
      ? buildTree(
          inventory.data.value,
          statuses.index.value,
          dockerIndex.value,
          proxmoxGuests.value,
          machineMetrics.value,
        )
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
    if (
      statuses.phase.value === 'loading' ||
      containerStatuses.phase.value === 'loading' ||
      proxmox.phase.value === 'loading'
    ) {
      return 'loading'
    }
    if (
      statuses.phase.value === 'failed' &&
      containerStatuses.phase.value === 'failed' &&
      proxmox.phase.value === 'failed'
    ) {
      return 'failed'
    }
    return 'ready'
  })

  const isManualRefreshing = ref(false)

  const refresh = async () => {
    if (isManualRefreshing.value) return
    isManualRefreshing.value = true
    try {
      await Promise.allSettled([
        inventory.refresh(),
        statuses.refresh(),
        containerStatuses.refresh(),
        proxmox.refresh(),
      ])
    } finally {
      isManualRefreshing.value = false
    }
  }

  return {
    view,
    tree,
    counts,
    livePhase,
    statusPhase: statuses.phase,
    statusError: statuses.errorMessage,
    containerStatusPhase: containerStatuses.phase,
    containerStatusError: containerStatuses.errorMessage,
    proxmoxPhase: proxmox.phase,
    proxmoxError: proxmox.errorMessage,
    /** The inventory failed to refresh while an older tree is still shown. */
    refreshError: computed(() => (tree.value ? inventory.errorMessage.value : null)),
    /** Message of the failure that made the page unusable. */
    fatalError: computed(() => (tree.value ? null : inventory.errorMessage.value)),
    isRefreshing: readonly(isManualRefreshing),
    updatedAt: inventory.updatedAt,
    refresh,
  }
}
