import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { netboxResponse } from '../__fixtures__'
import { NETBOX_GRAPHQL_URL } from '../config'
import {
  INVENTORY_SCHEMA_VERSION,
  INVENTORY_STORAGE_KEY,
  isValidInventory,
  isValidStoredInventory,
  useInventory,
} from './useInventory'

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body))
}

describe('useInventory & storage persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('validates inventory and stored inventory structure and schema version', () => {
    expect(isValidInventory(null)).toBe(false)
    expect(isValidInventory({})).toBe(false)
    expect(isValidInventory({ devices: [], vms: [], services: [] })).toBe(true)

    expect(isValidStoredInventory(null)).toBe(false)
    expect(isValidStoredInventory({ inventory: { devices: [], vms: [], services: [] } })).toBe(false)
    // Valid stored inventory with current schema version
    expect(
      isValidStoredInventory({
        version: INVENTORY_SCHEMA_VERSION,
        inventory: { devices: [], vms: [], services: [] },
        timestamp: '2026-10-03T18:00:00.000Z',
      }),
    ).toBe(true)

    // Missing version or wrong version must be rejected
    expect(
      isValidStoredInventory({
        inventory: { devices: [], vms: [], services: [] },
        timestamp: '2026-10-03T18:00:00.000Z',
      }),
    ).toBe(false)
    expect(
      isValidStoredInventory({
        version: 999,
        inventory: { devices: [], vms: [], services: [] },
        timestamp: '2026-10-03T18:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('stores successfully loaded inventory in localStorage on success', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === NETBOX_GRAPHQL_URL) return okResponse(netboxResponse)
      throw new Error(`unexpected ${url}`)
    })

    const inv = useInventory()
    await vi.waitFor(() => expect(inv.data.value).not.toBeNull())

    const storedRaw = localStorage.getItem(INVENTORY_STORAGE_KEY)
    expect(storedRaw).not.toBeNull()
    const parsed = JSON.parse(storedRaw!)
    expect(isValidStoredInventory(parsed)).toBe(true)
    expect(parsed.version).toBe(INVENTORY_SCHEMA_VERSION)
    expect(parsed.inventory.devices.length).toBeGreaterThan(0)
    expect(inv.updatedAt.value).not.toBeNull()
  })

  it('initializes immediately from stored inventory on open without waiting for network', async () => {
    // Pre-populate localStorage
    const savedTimestamp = '2026-10-01T12:00:00.000Z'
    localStorage.setItem(
      INVENTORY_STORAGE_KEY,
      JSON.stringify({
        version: INVENTORY_SCHEMA_VERSION,
        inventory: {
          devices: [{ id: '99', name: 'stored-machine', roleSlug: 'server', offline: false, tags: [], hardware: {} }],
          vms: [],
          services: [],
        },
        timestamp: savedTimestamp,
      }),
    )

    // Never-resolving fetch to verify immediate synchronous rendering
    vi.stubGlobal('fetch', () => new Promise(() => {}))

    const inv = useInventory()
    // Available immediately!
    expect(inv.data.value).not.toBeNull()
    expect(inv.data.value?.devices[0].name).toBe('stored-machine')
    expect(inv.updatedAt.value?.toISOString()).toBe(savedTimestamp)
  })

  it('replaces stored inventory with fresh one when network succeeds', async () => {
    localStorage.setItem(
      INVENTORY_STORAGE_KEY,
      JSON.stringify({
        version: INVENTORY_SCHEMA_VERSION,
        inventory: {
          devices: [{ id: '99', name: 'old-machine', roleSlug: 'server', offline: false, tags: [], hardware: {} }],
          vms: [],
          services: [],
        },
        timestamp: '2026-10-01T12:00:00.000Z',
      }),
    )

    vi.stubGlobal('fetch', async (url: string) => {
      if (url === NETBOX_GRAPHQL_URL) return okResponse(netboxResponse)
      throw new Error(`unexpected ${url}`)
    })

    const inv = useInventory()
    expect(inv.data.value?.devices[0].name).toBe('old-machine')

    await vi.waitFor(() => expect(inv.data.value?.devices.some((d) => d.name === 'node-alpha')).toBe(true))

    const storedRaw = localStorage.getItem(INVENTORY_STORAGE_KEY)
    const parsed = JSON.parse(storedRaw!)
    expect(parsed.inventory.devices.some((d: any) => d.name === 'node-alpha')).toBe(true)
    expect(parsed.version).toBe(INVENTORY_SCHEMA_VERSION)
  })

  it('keeps stored inventory and reports error message when NetBox cannot be reached', async () => {
    const savedTimestamp = '2026-10-02T10:00:00.000Z'
    localStorage.setItem(
      INVENTORY_STORAGE_KEY,
      JSON.stringify({
        version: INVENTORY_SCHEMA_VERSION,
        inventory: {
          devices: [{ id: '99', name: 'stored-machine', roleSlug: 'server', offline: false, tags: [], hardware: {} }],
          vms: [],
          services: [],
        },
        timestamp: savedTimestamp,
      }),
    )

    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('Failed to fetch')))

    const inv = useInventory()
    await vi.waitFor(() => expect(inv.errorMessage.value).toBe('NetBox is unreachable.'))

    // Previous stored inventory is STILL intact!
    expect(inv.data.value).not.toBeNull()
    expect(inv.data.value?.devices[0].name).toBe('stored-machine')
    expect(inv.updatedAt.value?.toISOString()).toBe(savedTimestamp)
  })

  it('ignores stored inventory of another schema version and starts with null', async () => {
    localStorage.setItem(
      INVENTORY_STORAGE_KEY,
      JSON.stringify({
        version: 999, // different schema version
        inventory: {
          devices: [{ id: '99', name: 'old-shape-machine', roleSlug: 'server', offline: false, tags: [], hardware: {} }],
          vms: [],
          services: [],
        },
        timestamp: '2026-10-01T12:00:00.000Z',
      }),
    )
    vi.stubGlobal('fetch', () => new Promise(() => {}))

    const inv = useInventory()
    expect(inv.data.value).toBeNull()
    expect(inv.updatedAt.value).toBeNull()
  })

  it('ignores corrupt JSON in storage and starts with null', async () => {
    localStorage.setItem(INVENTORY_STORAGE_KEY, 'corrupted{json:!')
    vi.stubGlobal('fetch', () => new Promise(() => {}))

    const inv = useInventory()
    expect(inv.data.value).toBeNull()
    expect(inv.updatedAt.value).toBeNull()
  })

  it('ignores incompatible or invalid shape in storage and starts with null', async () => {
    localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify({ wrong: 'schema' }))
    vi.stubGlobal('fetch', () => new Promise(() => {}))

    const inv = useInventory()
    expect(inv.data.value).toBeNull()
    expect(inv.updatedAt.value).toBeNull()
  })
})
