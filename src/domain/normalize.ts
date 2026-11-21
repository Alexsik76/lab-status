import type {
  DeviceHardware,
  DeviceRecord,
  Inventory,
  ServiceRecord,
  TagItem,
  VmKind,
  VmRecord,
} from './model'
import type {
  RawDevice,
  RawInventory,
  RawService,
  RawTag,
  RawVirtualMachine,
} from '../types/netbox'
import type { RawTopology } from '../types/topology'

const STACK_TAG_PREFIX = 'stack:'
const STANDALONE_STACK = 'standalone'
const IMAGE_PATTERN = /^\s*Image:\s*([^|]+?)\s*(?:\||$)/i

/** `"2.00"` -> 2; anything non-numeric -> null. */
export function parseVcpus(value: string | null | undefined): number | null {
  if (value == null) return null
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : null
}

function parseInteger(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return Math.round(val)
  }
  if (typeof val === 'string') {
    const parsed = Number.parseInt(val.trim(), 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function parseHardware(customFields: Record<string, unknown> | null | undefined): DeviceHardware {
  return {
    cpuCores: parseInteger(customFields?.cpu_cores),
    memoryGb: parseInteger(customFields?.memory_gb),
    storageGb: parseInteger(customFields?.storage_gb),
  }
}

export function normalizeTags(rawTags: readonly RawTag[] | null | undefined): TagItem[] {
  if (!rawTags) return []
  return rawTags
    .map((t) => {
      const name = t.name.trim()
      let color = t.color?.trim() || null
      if (color && !color.startsWith('#')) {
        color = `#${color}`
      }
      return { name, color }
    })
    .filter((t) => t.name !== '' && !t.name.startsWith(STACK_TAG_PREFIX))
}

/** First `stack:<name>` tag; `stack:standalone` and no tag both mean "no stack". */
export function parseStack(tags: readonly { name: string }[] | null | undefined): string | null {
  const tag = tags?.find((t) => t.name.startsWith(STACK_TAG_PREFIX))
  const name = tag?.name.slice(STACK_TAG_PREFIX.length).trim()
  return name && name !== STANDALONE_STACK ? name : null
}

/** Image from a description like `"Image: <image> | Hosted on: x"`. */
export function parseImage(description: string | null | undefined): string | null {
  return description?.match(IMAGE_PATTERN)?.[1] ?? null
}

/** Image from `custom_fields.image`; the description pattern is used only when that is empty. */
export function resolveImage(
  customFields: Record<string, unknown> | null | undefined,
  description: string | null | undefined,
): string | null {
  const field = customFields?.image
  if (typeof field === 'string' && field.trim() !== '') return field.trim()
  return parseImage(description)
}

/** Custom field `host` is a numeric VM id (or null); ids elsewhere are strings. */
export function parseHostId(customFields: Record<string, unknown> | null | undefined): string | null {
  const host = customFields?.host
  if (typeof host === 'number' || (typeof host === 'string' && host.trim() !== '')) {
    return String(host)
  }
  return null
}

/**
 * Select-type custom field: NetBox GraphQL returns `{ value, label }`, older responses a plain
 * string. Returns the trimmed, lower-cased value, or null when empty.
 */
export function parseChoice(field: unknown): string | null {
  const value =
    typeof field === 'object' && field !== null ? (field as { value?: unknown }).value : field
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized === '' ? null : normalized
}

export function parseAlias(customFields: Record<string, unknown> | null | undefined): string | null {
  const alias = customFields?.alias
  if (typeof alias === 'string' && alias.trim() !== '') {
    return alias.trim()
  }
  return null
}

function parseVmKind(typeName: string | undefined): VmKind {
  return typeName === 'KVM' || typeName === 'LXC' || typeName === 'Docker' ? typeName : 'other'
}

/** Strips CIDR prefix length (e.g. `"192.0.2.11/24"` -> `"192.0.2.11"`). */
export function stripAddressMask(address: string | null | undefined): string | null {
  if (!address) return null
  const plain = address.replace(/\/.*$/, '').trim()
  return plain || null
}

/** A Dashboard Icons name (lowercase letters, digits, dashes), or null. */
export function parseIcon(customFields: Record<string, unknown> | null | undefined): string | null {
  const icon = customFields?.icon
  if (typeof icon !== 'string') return null
  const name = icon.trim()
  return /^[a-z0-9-]+$/.test(name) ? name : null
}

/** The object's own `icon` wins over its platform's. */
const iconOf = (raw: RawDevice | RawVirtualMachine): string | null =>
  parseIcon(raw.custom_fields) ?? parseIcon(raw.platform?.custom_fields)

function normalizeDevice(raw: RawDevice): DeviceRecord {
  return {
    id: raw.id,
    name: raw.name ?? `device ${raw.id}`,
    roleSlug: raw.role?.slug ?? null,
    offline: raw.status === 'offline',
    model: raw.device_type?.model ?? null,
    manufacturer: raw.device_type?.manufacturer?.name ?? null,
    ip: stripAddressMask(raw.primary_ip4?.address),
    cluster: raw.cluster?.name ?? null,
    platform: raw.platform?.name ?? null,
    icon: iconOf(raw),
    tags: normalizeTags(raw.tags),
    hardware: parseHardware(raw.custom_fields),
  }
}

function normalizeVm(raw: RawVirtualMachine): VmRecord {
  return {
    id: raw.id,
    name: raw.name ?? `vm ${raw.id}`,
    alias: parseAlias(raw.custom_fields),
    kind: parseVmKind(raw.virtual_machine_type?.name),
    offline: raw.status === 'offline',
    vcpus: parseVcpus(raw.vcpus),
    memoryMb: raw.memory ?? null,
    disk: raw.disk ?? null,
    description: raw.description ?? '',
    image: resolveImage(raw.custom_fields, raw.description),
    stack: parseStack(raw.tags),
    tags: normalizeTags(raw.tags),
    cluster: raw.cluster?.name ?? null,
    platform: raw.platform?.name ?? null,
    icon: iconOf(raw),
    ip: stripAddressMask(raw.primary_ip4?.address),
    deviceId: raw.device?.id ?? null,
    hostId: parseHostId(raw.custom_fields),
  }
}

function normalizeService(raw: RawService): ServiceRecord {
  const { parent } = raw
  let link: ServiceRecord['parent'] = null
  if (parent?.id) {
    if (parent.__typename === 'VirtualMachineType') link = { kind: 'vm', id: parent.id }
    else if (parent.__typename === 'DeviceType') link = { kind: 'device', id: parent.id }
  }
  return {
    id: raw.id,
    name: raw.name ?? `service ${raw.id}`,
    ports: raw.ports ?? [],
    scheme: parseChoice(raw.custom_fields?.scheme),
    check: raw.custom_fields?.check === true,
    addresses: (raw.ipaddresses ?? [])
      .map((a) => stripAddressMask(a.address))
      .filter((a): a is string => a !== null),
    parent: link,
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * The backend's topology, when its shape holds (lists of vlans, ports and cables with string
 * ids); anything else is treated as not loaded.
 */
export function parseTopology(raw: unknown): RawTopology | null {
  if (!isObject(raw)) return null
  const { vlans, ports, cables } = raw
  if (!Array.isArray(vlans) || !Array.isArray(ports) || !Array.isArray(cables)) return null
  const portsOk = ports.every(
    (p) => isObject(p) && typeof p.id === 'string' && typeof p.deviceId === 'string' && typeof p.order === 'number',
  )
  const cablesOk = cables.every(
    (c) => isObject(c) && typeof c.id === 'string' && typeof c.a === 'string' && typeof c.b === 'string',
  )
  const vlansOk = vlans.every((v) => isObject(v) && typeof v.vid === 'number')
  if (!portsOk || !cablesOk || !vlansOk) return null
  return raw as unknown as RawTopology
}

/** NetBox status of hardware kept in reserve; it is not part of the running lab. */
const RESERVE_STATUS = 'inventory'

/** Objects in reserve are left out, together with the guests and services that belong to them. */
export function normalizeInventory(raw: RawInventory): Inventory {
  const devices = raw.device_list.filter((d) => d.status !== RESERVE_STATUS)
  const deviceIds = new Set(devices.map((d) => d.id))
  const vms = raw.virtual_machine_list.filter(
    (vm) => vm.status !== RESERVE_STATUS && (!vm.device?.id || deviceIds.has(vm.device.id)),
  )
  const vmIds = new Set(vms.map((vm) => vm.id))
  const services = raw.service_list.map(normalizeService).filter(({ parent }) => {
    if (!parent) return true
    return parent.kind === 'device' ? deviceIds.has(parent.id) : vmIds.has(parent.id)
  })
  return {
    devices: devices.map(normalizeDevice),
    vms: vms.map(normalizeVm),
    services,
    topology: parseTopology(raw.topology),
  }
}
