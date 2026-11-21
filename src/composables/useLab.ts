import { computed, readonly, ref, type Ref } from 'vue'
import type { ArpPresenceIndex } from '../domain/arp'
import { matchDockerContainers } from '../domain/containerStatuses'
import { mapMachineMetrics, matchProxmoxGuests } from '../domain/proxmox'
import { topologyDeviceIds } from '../domain/topologyLinks'
import { buildTree, countTree, MACHINE_ROLE } from '../domain/tree'
import { useContainerStatuses } from './useContainerStatuses'
import { useInventory } from './useInventory'
import { useProxmox } from './useProxmox'
import { useStatuses, type StatusPhase } from './useStatuses'

/** Start of the topology part's message in the inventory status (backend/app/inventory.py). */
export const TOPOLOGY_ERROR_PREFIX = 'Topology: '

export type LabView = 'loading' | 'fatal' | 'empty' | 'tree'

/**
 * The independent sources combined: the tree is built as soon as the
 * inventory is available and re-derived when statuses, container states,
 * Proxmox guest states / machine metrics, or ARP presence arrive.
 */
export function useLab(arpPresence?: Readonly<Ref<ArpPresenceIndex>>) {
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
          arpPresence?.value,
        )
      : null,
  )
  const counts = computed(() => (tree.value ? countTree(tree.value) : null))

  /** Changes only with the inventory; the graph itself is built in the Topology chunk. */
  const topology = computed(() => {
    const inv = inventory.data.value
    if (!inv?.topology) return null
    const machineIds = new Set(inv.devices.filter((d) => d.roleSlug === MACHINE_ROLE).map((d) => d.id))
    return { data: inv.topology, devices: inv.devices, machineIds }
  })
  /** The backend names a failed topology read `Topology: ...` while the rest refreshed. */
  const topologyError = computed(() => {
    const status = inventory.status.value
    return status?.state === 'live' && status.error?.includes(TOPOLOGY_ERROR_PREFIX) ? status.error : null
  })

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
      // The backend re-reads NetBox, NPM, Proxmox, the containers and re-runs every check.
      await inventory.refresh()
    } finally {
      isManualRefreshing.value = false
    }
  }

  return {
    view,
    tree,
    counts,
    topology,
    topologyDevices: computed(() => topologyDeviceIds(topology.value?.data, topology.value?.devices ?? [])),
    topologyError,
    /** The inventory status says why there is no topology (when it says anything). */
    inventoryError: inventory.errorMessage,
    livePhase,
    statusPhase: statuses.phase,
    statusError: statuses.errorMessage,
    hasStatusData: computed(() => statuses.data.value !== null),
    containerStatusPhase: containerStatuses.phase,
    containerStatusError: containerStatuses.errorMessage,
    hasContainerStatusData: computed(() => containerStatuses.data.value !== null),
    proxmoxPhase: proxmox.phase,
    proxmoxError: proxmox.errorMessage,
    hasProxmoxData: computed(() => proxmox.data.value !== null),
    /** The inventory failed to refresh while an older tree is still shown. */
    refreshError: computed(() => (tree.value ? inventory.errorMessage.value : null)),
    inventoryTimeText: inventory.inventoryTimeText,
    /** Message of the failure that made the page unusable. */
    fatalError: computed(() => (tree.value ? null : inventory.errorMessage.value)),
    isRefreshing: readonly(isManualRefreshing),
    updatedAt: inventory.updatedAt,
    refresh,
  }
}
