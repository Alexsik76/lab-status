import { describe, expect, it } from 'vitest'
import { rawInventory } from '../__fixtures__'
import {
  normalizeInventory,
  normalizeTags,
  parseHardware,
  parseHostId,
  parseImage,
  parseStack,
  parseVcpus,
  resolveImage,
  stripAddressMask,
} from './normalize'

describe('parsers', () => {
  it('parses vCPUs from the decimal string', () => {
    expect(parseVcpus('2.00')).toBe(2)
    expect(parseVcpus(null)).toBeNull()
    expect(parseVcpus('n/a')).toBeNull()
  })

  it('reads the stack from the tag and treats standalone as no stack', () => {
    expect(parseStack([{ name: 'other' }, { name: 'stack:workflow' }])).toBe('workflow')
    expect(parseStack([{ name: 'stack:standalone' }])).toBeNull()
    expect(parseStack([])).toBeNull()
    expect(parseStack(null)).toBeNull()
  })

  it('reads the image from the description', () => {
    expect(parseImage('Image: analytics-web | Hosted on: vm-services')).toBe('analytics-web')
    expect(parseImage('Image: postgres:16')).toBe('postgres:16')
    expect(parseImage('')).toBeNull()
    expect(parseImage('Hosted on: vm-services')).toBeNull()
    expect(parseImage(null)).toBeNull()
  })

  it('prefers custom_fields.image and falls back to the description when it is empty', () => {
    const description = 'Image: from-description | Hosted on: x'
    expect(resolveImage({ image: 'from-field:1' }, description)).toBe('from-field:1')
    expect(resolveImage({ image: '  ' }, description)).toBe('from-description')
    expect(resolveImage({ image: null }, description)).toBe('from-description')
    expect(resolveImage({}, description)).toBe('from-description')
    expect(resolveImage(null, '')).toBeNull()
    expect(resolveImage({ image: 'only-field' }, null)).toBe('only-field')
  })

  it('reads the host id from the custom field', () => {
    expect(parseHostId({ host: 3 })).toBe('3')
    expect(parseHostId({ host: null })).toBeNull()
    expect(parseHostId({})).toBeNull()
    expect(parseHostId(null)).toBeNull()
  })

  it('parses hardware integers from custom fields', () => {
    expect(parseHardware({ cpu_cores: 8, memory_gb: 15, storage_gb: null })).toEqual({
      cpuCores: 8,
      memoryGb: 15,
      storageGb: null,
    })
    expect(parseHardware({ cpu_cores: '4', memory_gb: '16' })).toEqual({
      cpuCores: 4,
      memoryGb: 16,
      storageGb: null,
    })
    expect(parseHardware(null)).toEqual({
      cpuCores: null,
      memoryGb: null,
      storageGb: null,
    })
  })

  it('normalizes tags: strips stack:* prefix, preserves color with # prefix', () => {
    const raw = [
      { name: 'ops', color: '9c27b0' },
      { name: 'stack:analytics', color: '9e9e9e' },
      { name: '  ', color: '123456' },
      { name: 'infra', color: '#ff0000' },
    ]
    expect(normalizeTags(raw)).toEqual([
      { name: 'ops', color: '#9c27b0' },
      { name: 'infra', color: '#ff0000' },
    ])
    expect(normalizeTags(null)).toEqual([])
  })

  it('strips prefix length mask from IP addresses', () => {
    expect(stripAddressMask('192.0.2.11/24')).toBe('192.0.2.11')
    expect(stripAddressMask('198.51.100.100/16')).toBe('198.51.100.100')
    expect(stripAddressMask('192.0.2.1')).toBe('192.0.2.1')
    expect(stripAddressMask(' 192.0.2.5/24 ')).toBe('192.0.2.5')
    expect(stripAddressMask(null)).toBeNull()
    expect(stripAddressMask('')).toBeNull()
  })
})

describe('normalizeInventory (real data)', () => {
  const inventory = normalizeInventory(rawInventory)

  it('keeps every record', () => {
    expect(inventory.devices).toHaveLength(rawInventory.device_list.length)
    expect(inventory.vms).toHaveLength(rawInventory.virtual_machine_list.length)
    expect(inventory.services).toHaveLength(rawInventory.service_list.length)
  })

  it('strips network masks so the model holds plain addresses for devices, VMs and services', () => {
    const alpha = inventory.devices.find((d) => d.name === 'node-alpha')
    expect(alpha?.ip).toBe('192.0.2.11')

    const home = inventory.vms.find((v) => v.name === 'vm-home')
    expect(home?.ip).toBe('198.51.100.100')

    const nasSvc = inventory.services.find((s) => s.name === 'nas-web')
    expect(nasSvc?.addresses).toEqual(['192.0.2.50'])

    const allIps = [
      ...inventory.devices.map((d) => d.ip),
      ...inventory.vms.map((v) => v.ip),
      ...inventory.services.flatMap((s) => s.addresses),
    ].filter((ip): ip is string => ip !== null)

    expect(allIps.length).toBeGreaterThan(0)
    expect(allIps.every((ip) => !ip.includes('/'))).toBe(true)
  })

  it('maps VM kinds, hosts and stacks', () => {
    const kinds = new Set(inventory.vms.map((vm) => vm.kind))
    expect(kinds).toEqual(new Set(['KVM', 'LXC', 'Docker']))
    const analytics = inventory.vms.find((vm) => vm.name === 'analytics-web')
    expect(analytics).toMatchObject({ kind: 'Docker', hostId: '3', stack: 'analytics', image: 'analytics-web:latest' })
  })

  it('distinguishes VM and device parents of services', () => {
    const parents = inventory.services.map((s) => s.parent?.kind)
    expect(parents.filter((p) => p === 'vm')).toHaveLength(15)
    expect(parents.filter((p) => p === 'device')).toHaveLength(5)
  })
})
