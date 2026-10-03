import type {
  Container,
  DeviceRecord,
  Guest,
  Inventory,
  LabTree,
  Machine,
  ServiceItem,
  ServiceRecord,
  ServiceState,
  Stack,
  TreeCounts,
  VmRecord,
} from './model'
import { resolveState } from './state'
import type { StatusEntry } from '../types/status'
import { resolveContainerState, type DockerStatusIndex } from './containerStatuses'
import {
  resolveGuestState,
  type MachineMetricsIndex,
  type ProxmoxGuestIndex,
} from './proxmox'

const MACHINE_ROLE = 'server'

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name)

type StatusIndex = ReadonlyMap<string, StatusEntry>
type ServicesByParent = ReadonlyMap<string, ServiceRecord[]>

const parentKey = (kind: 'vm' | 'device', id: string) => `${kind}:${id}`

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    if (key === null) continue
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}

function toServiceItem(record: ServiceRecord, statuses: StatusIndex): ServiceItem {
  const entry = statuses.get(record.id)
  const state: ServiceState = entry ? (entry.up ? 'up' : 'down') : 'unknown'
  return {
    id: record.id,
    name: record.name,
    ports: record.ports,
    scheme: record.scheme,
    addresses: record.addresses,
    url: entry?.url ?? null,
    state,
    httpCode: entry?.code ?? null,
    error: entry?.error || null,
  }
}

interface BuildContext {
  statuses: StatusIndex
  services: ServicesByParent
  dockerStatuses: DockerStatusIndex
  proxmoxGuests: ProxmoxGuestIndex
  machineMetrics: MachineMetricsIndex
}

function servicesOf(ctx: BuildContext, kind: 'vm' | 'device', id: string): ServiceItem[] {
  return (ctx.services.get(parentKey(kind, id)) ?? []).map((s) => toServiceItem(s, ctx.statuses))
}

function buildContainer(ctx: BuildContext, vm: VmRecord): Container {
  const services = servicesOf(ctx, 'vm', vm.id)
  const dockerEntry = ctx.dockerStatuses.get(vm.id)
  const { state, blinking, dockerStatus } = resolveContainerState(
    vm,
    services.map((s) => s.state),
    dockerEntry,
  )
  return {
    id: vm.id,
    name: vm.name,
    image: vm.image,
    stack: vm.stack,
    tags: vm.tags ?? [],
    services,
    state,
    blinking,
    dockerStatus,
  }
}

function buildContainers(ctx: BuildContext, vms: readonly VmRecord[] = []): Container[] {
  return vms.map((vm) => buildContainer(ctx, vm)).sort(byName)
}

function buildStacks(containers: readonly Container[]): Stack[] {
  const named = containers.filter((c) => c.stack !== null)
  return [...groupBy(named, (c) => c.stack)]
    .map(([name, members]) => ({
      name,
      containers: members,
      state: resolveState({
        offline: false,
        serviceStates: [],
        childStates: members.map((c) => c.state),
      }),
    }))
    .sort(byName)
}

function buildGuest(ctx: BuildContext, vm: VmRecord & { kind: 'KVM' | 'LXC' }, children: VmRecord[]): Guest {
  const containers = buildContainers(ctx, children)
  const services = servicesOf(ctx, 'vm', vm.id)
  const proxmoxGuest = ctx.proxmoxGuests.get(vm.id)
  const { state, blinking } = resolveGuestState(
    vm,
    services.map((s) => s.state),
    proxmoxGuest,
    containers.map((c) => c.state),
  )
  return {
    id: vm.id,
    name: vm.name,
    kind: vm.kind,
    vcpus: vm.vcpus,
    memoryMb: vm.memoryMb,
    disk: vm.disk,
    ip: vm.ip,
    platform: vm.platform,
    cluster: vm.cluster,
    tags: vm.tags ?? [],
    services,
    stacks: buildStacks(containers),
    standalone: containers.filter((c) => c.stack === null),
    state,
    blinking,
  }
}

function buildMachine(
  ctx: BuildContext,
  device: DeviceRecord,
  guests: Guest[],
  apps: Container[],
): Machine {
  const services = servicesOf(ctx, 'device', device.id)
  const metrics = ctx.machineMetrics.get(device.name) ?? null
  return {
    id: device.id,
    name: device.name,
    model: device.model,
    manufacturer: device.manufacturer,
    ip: device.ip,
    platform: device.platform,
    cluster: device.cluster,
    tags: device.tags ?? [],
    hardware: device.hardware,
    services,
    guests,
    apps,
    metrics,
    state: resolveState({
      offline: device.offline,
      serviceStates: services.map((s) => s.state),
      childStates: [...guests.map((g) => g.state), ...apps.map((a) => a.state)],
    }),
  }
}

const isGuestVm = (vm: VmRecord): vm is VmRecord & { kind: 'KVM' | 'LXC' } =>
  vm.kind === 'KVM' || vm.kind === 'LXC'

/**
 * Builds machine -> guest -> stack -> container from the inventory and overlays
 * the live statuses. Pure: with an empty status index every state is unknown
 * (or stopped, which comes from NetBox).
 */
export function buildTree(
  inventory: Inventory,
  statuses: StatusIndex = new Map(),
  dockerStatuses: DockerStatusIndex = new Map(),
  proxmoxGuests: ProxmoxGuestIndex = new Map(),
  machineMetrics: MachineMetricsIndex = new Map(),
): LabTree {
  const ctx: BuildContext = {
    statuses,
    services: groupBy(inventory.services, (s) => (s.parent ? parentKey(s.parent.kind, s.parent.id) : null)),
    dockerStatuses,
    proxmoxGuests,
    machineMetrics,
  }

  const machineRecords = inventory.devices.filter((d) => d.roleSlug === MACHINE_ROLE)
  const machineIds = new Set(machineRecords.map((m) => m.id))

  const guestRecords = inventory.vms.filter(
    (vm): vm is VmRecord & { kind: 'KVM' | 'LXC' } =>
      isGuestVm(vm) && vm.deviceId !== null && machineIds.has(vm.deviceId),
  )
  const guestIds = new Set(guestRecords.map((g) => g.id))

  const docker = inventory.vms.filter((vm) => vm.kind === 'Docker')
  const containersByGuest = groupBy(docker, (vm) => (vm.hostId !== null && guestIds.has(vm.hostId) ? vm.hostId : null))
  const appsByMachine = groupBy(docker, (vm) =>
    vm.hostId === null && vm.deviceId !== null && machineIds.has(vm.deviceId) ? vm.deviceId : null,
  )
  const guestsByMachine = groupBy(guestRecords, (g) => g.deviceId)

  const placed = new Set([...containersByGuest.values(), ...appsByMachine.values()].flat())
  const unplaced = buildContainers(ctx, docker.filter((vm) => !placed.has(vm)))

  const machines = machineRecords
    .map((device) =>
      buildMachine(
        ctx,
        device,
        (guestsByMachine.get(device.id) ?? [])
          .map((g) => buildGuest(ctx, g, containersByGuest.get(g.id) ?? []))
          .sort(byName),
        buildContainers(ctx, appsByMachine.get(device.id)),
      ),
    )
    .sort(byName)

  return { machines, unplaced }
}

export function countTree(tree: LabTree): TreeCounts {
  const guests = tree.machines.flatMap((m) => m.guests)
  const guestContainers = guests.reduce(
    (sum, g) => sum + g.standalone.length + g.stacks.reduce((n, s) => n + s.containers.length, 0),
    0,
  )
  return {
    machines: tree.machines.length,
    guests: guests.length,
    stoppedGuests: guests.filter((g) => g.state === 'stopped').length,
    containers: guestContainers + tree.machines.reduce((n, m) => n + m.apps.length, 0),
  }
}
