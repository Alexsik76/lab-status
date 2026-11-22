import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { netboxResponse } from '../__fixtures__'
import { FakeEventSource } from '../__fixtures__/fakeEventSource'
import { REFRESH_URL } from '../config'
import { createEventStream, type EventStream } from './useEventStream'
import {
  INVENTORY_SCHEMA_VERSION,
  INVENTORY_STORAGE_KEY,
  isValidInventory,
  isValidStoredInventory,
  useInventory,
} from './useInventory'

/*
 * NetBox is read by the backend; the composable gets `inventory` events from the stream.
 * "The network" in these tests is that stream: `deliver` plays a successful backend cycle
 * (data, then a live status), `failWith` a failed one, and no events a slow backend.
 */
let stream: EventStream

const status = (state: string, error: string | null, updatedAt: string | null) => ({
  type: 'status',
  state,
  error,
  updatedAt,
  periodS: 300,
})

function deliver(data: unknown = netboxResponse.data, updatedAt = '2026-11-16T12:00:00Z') {
  FakeEventSource.latest().emit('inventory', { type: 'data', data })
  FakeEventSource.latest().emit('inventory', status('live', null, updatedAt))
}

function failWith(error: string) {
  FakeEventSource.latest().emit('inventory', status('error', error, null))
}

function useInventoryOnStream() {
  return effectScope().run(() => useInventory(stream))!
}

describe('useInventory & storage persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    FakeEventSource.instances = []
    stream = createEventStream({ url: '/api/stream', eventSource: FakeEventSource as unknown as typeof EventSource })
  })

  afterEach(() => {
    stream.close()
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
    const inv = useInventoryOnStream()
    deliver()
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

    // No event from the backend yet: the stored inventory must render synchronously
    const inv = useInventoryOnStream()
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

    const inv = useInventoryOnStream()
    expect(inv.data.value?.devices[0].name).toBe('old-machine')
    deliver()

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

    const inv = useInventoryOnStream()
    failWith('NetBox is unreachable.')
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
    const inv = useInventoryOnStream()
    expect(inv.data.value).toBeNull()
    expect(inv.updatedAt.value).toBeNull()
  })

  it('ignores corrupt JSON in storage and starts with null', async () => {
    localStorage.setItem(INVENTORY_STORAGE_KEY, 'corrupted{json:!')
    const inv = useInventoryOnStream()
    expect(inv.data.value).toBeNull()
    expect(inv.updatedAt.value).toBeNull()
  })

  it('ignores incompatible or invalid shape in storage and starts with null', async () => {
    localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify({ wrong: 'schema' }))
    const inv = useInventoryOnStream()
    expect(inv.data.value).toBeNull()
    expect(inv.updatedAt.value).toBeNull()
  })

  it('takes updatedAt from the backend status and stores it with the inventory', async () => {
    const inv = useInventoryOnStream()
    deliver(netboxResponse.data, '2026-11-16T12:00:00Z')
    expect(inv.updatedAt.value?.toISOString()).toBe('2026-11-16T12:00:00.000Z')
    // A later cycle with unchanged data sends only a status.
    FakeEventSource.latest().emit('inventory', status('live', null, '2026-11-16T12:05:00Z'))
    expect(inv.updatedAt.value?.toISOString()).toBe('2026-11-16T12:05:00.000Z')
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem(INVENTORY_STORAGE_KEY) ?? 'null')?.timestamp).toBe('2026-11-16T12:05:00.000Z'),
    )
    expect(inv.errorMessage.value).toBeNull()
  })

  it('touches the storage once per new time, not for every status', async () => {
    useInventoryOnStream()
    deliver(netboxResponse.data, '2026-11-16T12:00:00Z')
    await nextTick()
    // Every store of the inventory serializes it and reads the stored copy to compare.
    const getItem = vi.spyOn(localStorage, 'getItem')
    const setItem = vi.spyOn(localStorage, 'setItem')
    try {
      // A status repeating the time, and one that only reports an error: nothing to store.
      FakeEventSource.latest().emit('inventory', status('live', null, '2026-11-16T12:00:00Z'))
      FakeEventSource.latest().emit('inventory', status('live', 'Nginx Proxy Manager is unreachable.', '2026-11-16T12:00:00Z'))
      await nextTick()
      expect(getItem).not.toHaveBeenCalled()
      expect(setItem).not.toHaveBeenCalled()
      // The next successful cycle with unchanged data: one write, with the new time.
      FakeEventSource.latest().emit('inventory', status('live', null, '2026-11-16T12:05:00Z'))
      await nextTick()
      expect(setItem).toHaveBeenCalledTimes(1)
      expect(JSON.parse(localStorage.getItem(INVENTORY_STORAGE_KEY) ?? 'null')?.timestamp).toBe('2026-11-16T12:05:00.000Z')
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('takes updatedAt from a status that arrives before the data (a new subscriber)', () => {
    const inv = useInventoryOnStream()
    FakeEventSource.latest().emit('inventory', status('connecting', null, '2026-11-16T11:55:00Z'))
    expect(inv.updatedAt.value).toBeNull()
    FakeEventSource.latest().emit('inventory', { type: 'data', data: netboxResponse.data })
    expect(inv.updatedAt.value?.toISOString()).toBe('2026-11-16T11:55:00.000Z')
  })

  it('keeps the data after a failed backend cycle and clears the error on recovery', () => {
    const inv = useInventoryOnStream()
    deliver()
    failWith('NetBox responded with HTTP 502 Bad Gateway.')
    expect(inv.errorMessage.value).toBe('NetBox responded with HTTP 502 Bad Gateway.')
    expect(inv.data.value?.devices.some((d) => d.name === 'node-alpha')).toBe(true)
    deliver()
    expect(inv.errorMessage.value).toBeNull()
  })

  it('does not report a partial failure of the backend cycle as an inventory error', () => {
    const inv = useInventoryOnStream()
    deliver()
    FakeEventSource.latest().emit(
      'inventory',
      status('live', 'Nginx Proxy Manager is unreachable.', '2026-11-16T12:05:00Z'),
    )
    expect(inv.errorMessage.value).toBeNull()
  })

  it('rejects a payload without inventory data and keeps the last inventory', () => {
    const inv = useInventoryOnStream()
    deliver()
    FakeEventSource.latest().emit('inventory', { type: 'data', data: { device_list: [] } })
    expect(inv.errorMessage.value).toBe('NetBox returned an unexpected response (inventory data is missing).')
    expect(inv.data.value?.devices.length).toBeGreaterThan(0)
  })

  it('says the backend is unreachable only when there is nothing to show', () => {
    const inv = useInventoryOnStream()
    FakeEventSource.latest().fail(false)
    expect(inv.errorMessage.value).toBe('The status backend stream is unreachable.')
    FakeEventSource.latest().open()
    deliver()
    FakeEventSource.latest().fail(false)
    expect(inv.errorMessage.value).toBeNull()
  })

  it('refresh asks the backend with POST /api/refresh and nothing else', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const inv = useInventoryOnStream()
    await inv.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toEqual([REFRESH_URL, expect.objectContaining({ method: 'POST' })])
  })
})
