import type { DockerContainerEntry } from '../types/containerStatus'
import type { Inventory, ServiceState, State, VmRecord } from './model'
import { resolveState } from './state'

export type DockerStatusIndex = ReadonlyMap<string, DockerContainerEntry>

/**
 * Matches Docker entries to NetBox containers by `alias`:
 * - A Docker entry belongs to the NetBox container whose custom_fields.alias equals the entry's name.
 * - If several containers share that alias, take the one whose host VM name equals env.
 * - Entries with no NetBox container are ignored.
 * - Containers with no Docker entry (apps on a host machine) keep the current rules.
 */
export function matchDockerContainers(
  entries: readonly DockerContainerEntry[],
  inventory: Inventory,
): DockerStatusIndex {
  const index = new Map<string, DockerContainerEntry>()

  const dockerVms = inventory.vms.filter((vm) => vm.kind === 'Docker')
  const vmNamesById = new Map<string, string>(inventory.vms.map((vm) => [vm.id, vm.name]))

  // Group NetBox containers by alias
  const byAlias = new Map<string, VmRecord[]>()
  for (const vm of dockerVms) {
    if (vm.alias) {
      const list = byAlias.get(vm.alias)
      if (list) {
        list.push(vm)
      } else {
        byAlias.set(vm.alias, [vm])
      }
    }
  }

  for (const entry of entries) {
    const candidates = byAlias.get(entry.name)
    if (!candidates || candidates.length === 0) {
      continue
    }

    if (candidates.length === 1) {
      index.set(candidates[0].id, entry)
      continue
    }

    // Several containers share this alias: take the one whose host VM name equals env
    const match = candidates.find((c) => {
      const hostVmName = c.hostId ? vmNamesById.get(c.hostId) ?? null : null
      return hostVmName === entry.env
    })

    if (match) {
      index.set(match.id, entry)
    }
  }

  return index
}

export interface ContainerStateResult {
  state: State
  blinking: boolean
  dockerStatus: string | null
}

/**
 * State rules for a container:
 * - When a live source has data (Docker entry or HTTP check), state comes from live data only.
 * - Docker state is anything but "running" -> stopped (grey).
 * - Docker running and its HTTP check fails -> down: red and blinking.
 * - Docker running and the HTTP check passes or does not exist -> up (green).
 * - NetBox "offline" is a fallback, used only when no live data exists for the container.
 */
export function resolveContainerState(
  vm: VmRecord,
  serviceStates: readonly ServiceState[],
  dockerEntry?: DockerContainerEntry | null,
): ContainerStateResult {
  if (!dockerEntry) {
    const state = resolveState({
      offline: vm.offline,
      serviceStates,
      childStates: [],
    })
    return {
      state,
      blinking: false,
      dockerStatus: null,
    }
  }

  const dockerStatus = dockerEntry.status
  if (dockerEntry.state.toLowerCase() !== 'running') {
    return {
      state: 'stopped',
      blinking: false,
      dockerStatus,
    }
  }

  const checked = serviceStates.filter((s) => s !== 'unknown')
  if (checked.includes('down')) {
    return {
      state: 'down',
      blinking: true,
      dockerStatus,
    }
  }

  return {
    state: 'up',
    blinking: false,
    dockerStatus,
  }
}
