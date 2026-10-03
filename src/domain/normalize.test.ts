import { describe, expect, it } from 'vitest'
import { rawInventory } from '../__fixtures__'
import { normalizeInventory, parseHostId, parseImage, parseStack, resolveImage, parseVcpus } from './normalize'

describe('parsers', () => {
  it('parses vCPUs from the decimal string', () => {
    expect(parseVcpus('2.00')).toBe(2)
    expect(parseVcpus(null)).toBeNull()
    expect(parseVcpus('n/a')).toBeNull()
  })

  it('reads the stack from the tag and treats standalone as no stack', () => {
    expect(parseStack([{ name: 'other' }, { name: 'stack:n8n' }])).toBe('n8n')
    expect(parseStack([{ name: 'stack:standalone' }])).toBeNull()
    expect(parseStack([])).toBeNull()
    expect(parseStack(null)).toBeNull()
  })

  it('reads the image from the description', () => {
    expect(parseImage('Image: bi-studio-web | Hosted on: treehouse')).toBe('bi-studio-web')
    expect(parseImage('Image: postgres:16')).toBe('postgres:16')
    expect(parseImage('')).toBeNull()
    expect(parseImage('Hosted on: treehouse')).toBeNull()
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
})

describe('normalizeInventory (real data)', () => {
  const inventory = normalizeInventory(rawInventory)

  it('keeps every record', () => {
    expect(inventory.devices).toHaveLength(rawInventory.device_list.length)
    expect(inventory.vms).toHaveLength(rawInventory.virtual_machine_list.length)
    expect(inventory.services).toHaveLength(rawInventory.service_list.length)
  })

  it('maps VM kinds, hosts and stacks', () => {
    const kinds = new Set(inventory.vms.map((vm) => vm.kind))
    expect(kinds).toEqual(new Set(['KVM', 'LXC', 'Docker']))
    const bi = inventory.vms.find((vm) => vm.name === 'bi-studio-web-1')
    expect(bi).toMatchObject({ kind: 'Docker', hostId: '3', stack: 'bi-studio', image: 'bi-studio-web' })
  })

  it('distinguishes VM and device parents of services', () => {
    const parents = inventory.services.map((s) => s.parent?.kind)
    expect(parents.filter((p) => p === 'vm')).toHaveLength(15)
    expect(parents.filter((p) => p === 'device')).toHaveLength(7)
  })
})
