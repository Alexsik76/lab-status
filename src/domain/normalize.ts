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
  const scheme =
    typeof raw.custom_fields?.scheme === 'string' && raw.custom_fields.scheme.trim() !== ''
      ? raw.custom_fields.scheme.trim().toLowerCase()
      : null
  return {
    id: raw.id,
    name: raw.name ?? `service ${raw.id}`,
    ports: raw.ports ?? [],
    scheme,
    addresses: (raw.ipaddresses ?? [])
      .map((a) => stripAddressMask(a.address))
      .filter((a): a is string => a !== null),
    parent: link,
  }
}

export function normalizeInventory(raw: RawInventory): Inventory {
  return {
    devices: raw.device_list.map(normalizeDevice),
    vms: raw.virtual_machine_list.map(normalizeVm),
    services: raw.service_list.map(normalizeService),
  }
}
