import type {
  ProxmoxGuestResource,
  ProxmoxNodeResource,
  ProxmoxResourceItem,
  ProxmoxRrdPoint,
} from '../types/proxmox'
import type {
  Inventory,
  MachineMetrics,
  ServiceState,
  SparklineData,
  State,
  VmRecord,
} from './model'
import { resolveState } from './state'

export type ProxmoxGuestIndex = ReadonlyMap<string, ProxmoxGuestResource>
export type MachineMetricsIndex = ReadonlyMap<string, MachineMetrics>

/**
 * Builds SVG sparkline path data for a sequence of values normalized in [0, 1].
 * Generates an area polygon and a line path, matching the approved dashboard design.
 */
export function buildSparkline(
  vals: readonly number[],
  width = 50,
  height = 14,
): SparklineData | null {
  if (vals.length < 2) return null

  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width
    const clamped = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
    // Keep 1px padding from top and bottom borders
    const y = height - 1 - clamped * (height - 2)
    return [x, y] as const
  })

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${width} ${height} L0 ${height} Z`

  return { line, area }
}

/**
 * Matches Proxmox guests (qemu/lxc) to NetBox VMs/LXCs by name.
 * Proxmox entries with no NetBox record are ignored.
 */
export function matchProxmoxGuests(
  resources: readonly ProxmoxResourceItem[],
  inventory: Inventory,
): ProxmoxGuestIndex {
  const index = new Map<string, ProxmoxGuestResource>()

  // NetBox guest VMs (KVM or LXC) indexed by name
  const vmsByName = new Map<string, VmRecord>()
  for (const vm of inventory.vms) {
    if (vm.kind === 'KVM' || vm.kind === 'LXC') {
      vmsByName.set(vm.name, vm)
    }
  }

  for (const item of resources) {
    if (item.type !== 'qemu' && item.type !== 'lxc') continue
    const guest = item as ProxmoxGuestResource
    if (!guest.name) continue

    const matchedVm = vmsByName.get(guest.name)
    if (matchedVm) {
      index.set(matchedVm.id, guest)
    }
  }

  return index
}

export interface GuestStateResult {
  state: State
  blinking: boolean
}

/**
 * State rules for a guest:
 * - When a live source has data (Proxmox entry or HTTP check), state comes from live data only.
 * - Proxmox says stopped -> stopped (grey).
 * - Proxmox running and its HTTP check fails -> down: red and blinking.
 * - Proxmox running and the HTTP check passes or does not exist -> up.
 * - NetBox "offline" is a fallback, used only when no live data exists for the guest.
 */
export function resolveGuestState(
  vm: VmRecord,
  serviceStates: readonly ServiceState[],
  proxmoxGuest?: ProxmoxGuestResource | null,
  childStates: readonly State[] = [],
): GuestStateResult {
  if (!proxmoxGuest) {
    const state = resolveState({
      offline: vm.offline,
      serviceStates,
      childStates,
    })
    return {
      state,
      blinking: false,
    }
  }

  if (proxmoxGuest.status.toLowerCase() !== 'running') {
    return {
      state: 'stopped',
      blinking: false,
    }
  }

  const checked = serviceStates.filter((s) => s !== 'unknown')
  if (checked.includes('down')) {
    return {
      state: 'down',
      blinking: true,
    }
  }

  return {
    state: 'up',
    blinking: false,
  }
}

/**
 * Maps Proxmox node resources and RRD points into MachineMetrics indexed by machine name.
 * Only machines that exist as Proxmox nodes get metrics.
 */
export function mapMachineMetrics(
  resources: readonly ProxmoxResourceItem[],
  rrdByNode: Record<string, readonly ProxmoxRrdPoint[]>,
): MachineMetricsIndex {
  const index = new Map<string, MachineMetrics>()

  for (const item of resources) {
    if (item.type !== 'node') continue
    const node = item as ProxmoxNodeResource
    if (!node.node) continue

    const cpuPct = `${Math.round(Math.max(0, Math.min(1, node.cpu || 0)) * 100)}%`
    const memRatio = node.maxmem > 0 ? (node.mem || 0) / node.maxmem : 0
    const memPct = `${Math.round(Math.max(0, Math.min(1, memRatio)) * 100)}%`

    const points = rrdByNode[node.node] ?? []
    const cpuVals = points.map((p) =>
      typeof p.cpu === 'number' && Number.isFinite(p.cpu) ? Math.max(0, Math.min(1, p.cpu)) : 0,
    )
    const memVals = points.map((p) => {
      if (typeof p.memused === 'number' && typeof p.memtotal === 'number' && p.memtotal > 0) {
        return Math.max(0, Math.min(1, p.memused / p.memtotal))
      }
      return 0
    })

    index.set(node.node, {
      cpu: {
        currentPct: cpuPct,
        spark: buildSparkline(cpuVals, 50, 14),
      },
      mem: {
        currentPct: memPct,
        spark: buildSparkline(memVals, 50, 14),
      },
    })
  }

  return index
}
