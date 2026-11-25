import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  containerStatusEntries,
  netboxResponse,
  proxmoxResources,
  proxmoxRrdPoints,
  statusEntries,
} from './__fixtures__'
import { FakeEventSource } from './__fixtures__/fakeEventSource'
import { topologyPayload } from './__fixtures__/topology'
import App from './App.vue'
import { REFRESH_URL } from './config'
import { INVENTORY_SCHEMA_VERSION, INVENTORY_STORAGE_KEY } from './composables/useInventory'
import { normalizeInventory } from './domain/normalize'

// Unmounting closes the app's shared stream, so every test opens its own.
enableAutoUnmount(afterEach)

beforeEach(() => {
  localStorage.clear()
  FakeEventSource.instances = []
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

type Handler = () => Promise<Response>
const ok = (body: unknown) => async () => new Response(JSON.stringify(body))
const down: Handler = async () => Promise.reject(new TypeError('Failed to fetch'))

/** Controllable promise, to hold a response back and release it later. */
function deferred() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  return { gate, release }
}

function stubBackend(handlers: {
  netbox: Handler
  status: Handler
  containerStatus?: Handler
  proxmoxResources?: Handler
  proxmoxRrd?: Handler
  /** Held before the backend answers POST /api/refresh. */
  refreshGate?: () => Promise<void>
}) {
  const containerStatusHandler = handlers.containerStatus ?? ok(containerStatusEntries)
  const proxmoxResourcesHandler = handlers.proxmoxResources ?? ok({ data: proxmoxResources })
  const proxmoxRrdHandler = handlers.proxmoxRrd ?? ok({ data: proxmoxRrdPoints })

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === REFRESH_URL && init?.method === 'POST') {
      await handlers.refreshGate?.()
      // The backend runs its polling sources at once; their results arrive over the stream.
      const es = FakeEventSource.latest()
      void feedInventory(es, handlers.netbox)
      void feedProxmox(es, proxmoxResourcesHandler, proxmoxRrdHandler)
      void feedContainers(es, containerStatusHandler)
      void feedServices(es, handlers.status)
      return new Response(
        JSON.stringify({ refreshing: ['inventory', 'services', 'proxmox', 'metrics', 'containers'] }),
        { status: 202 },
      )
    }
    throw new Error(`unexpected request ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  // Everything reaches the page over the backend stream: the handlers stand for the backend's
  // upstream answers (NetBox, the service checks, Proxmox, Portainer), and their outcome is
  // sent as `inventory` / `services` / `proxmox` / `metrics` / `containers` events.
  class BackendStream extends FakeEventSource {
    constructor(url: string) {
      super(url)
      this.open()
      void feedInventory(this, handlers.netbox)
      void feedProxmox(this, proxmoxResourcesHandler, proxmoxRrdHandler)
      void feedContainers(this, containerStatusHandler)
      void feedServices(this, handlers.status)
    }
  }
  vi.stubGlobal('EventSource', BackendStream)
  return fetchMock
}

const sourceStatus = (state: 'live' | 'error', error: string | null = null) => ({
  type: 'status',
  state,
  error,
  updatedAt: state === 'live' ? new Date().toISOString() : null,
  periodS: 15,
})

/** What the backend's inventory source publishes for this NetBox GraphQL answer. */
async function feedInventory(es: FakeEventSource, netbox: Handler) {
  let body: { data?: unknown; errors?: Array<{ message: string }> }
  try {
    body = (await (await netbox()).json()) as typeof body
  } catch {
    es.emit('inventory', { ...sourceStatus('error', 'NetBox is unreachable.'), periodS: 300 })
    return
  }
  if (body.errors?.length) {
    const message = `NetBox rejected the query: ${body.errors.map((e) => e.message).join('; ')}`
    es.emit('inventory', { ...sourceStatus('error', message), periodS: 300 })
    return
  }
  es.emit('inventory', { type: 'data', data: body.data })
  es.emit('inventory', { ...sourceStatus('live'), periodS: 300 })
}

/** What the backend's services source publishes for these check results. */
async function feedServices(es: FakeEventSource, status: Handler) {
  let entries: unknown
  try {
    entries = await (await status()).json()
  } catch {
    es.emit('services', { ...sourceStatus('error', 'NetBox is unreachable.'), periodS: 180 })
    return
  }
  es.emit('services', { type: 'data', data: entries })
  es.emit('services', { ...sourceStatus('live'), periodS: 180 })
}

/** What the backend's containers source publishes for this list of container states. */
async function feedContainers(es: FakeEventSource, containers: Handler) {
  let entries: unknown
  try {
    entries = await (await containers()).json()
  } catch {
    es.emit('containers', { ...sourceStatus('error', 'docker-1: Portainer is unreachable.'), periodS: 300 })
    return
  }
  es.emit('containers', { type: 'data', data: entries })
  es.emit('containers', { ...sourceStatus('live'), periodS: 300 })
}

/** What the backend's Proxmox sources publish for these upstream answers. */
async function feedProxmox(es: FakeEventSource, resources: Handler, rrd: Handler) {
  let items: Array<{ type: string; node?: string }>
  try {
    items = ((await (await resources()).json()) as { data: typeof items }).data
  } catch {
    es.emit('proxmox', sourceStatus('error', 'Proxmox is unreachable.'))
    return
  }
  es.emit('proxmox', { type: 'data', data: items })
  es.emit('proxmox', sourceStatus('live'))
  const nodes = items.filter((i) => i.type === 'node' && typeof i.node === 'string').map((i) => i.node as string)
  const points = await Promise.all(
    nodes.map(async (node) => {
      try {
        return [node, ((await (await rrd()).json()) as { data: unknown[] }).data] as const
      } catch {
        return [node, []] as const
      }
    }),
  )
  es.emit('metrics', { type: 'data', data: Object.fromEntries(points) })
  es.emit('metrics', sourceStatus('live'))
}

async function mountApp() {
  const wrapper = mount(App)
  await vi.waitFor(() => expect(wrapper.find('main').exists()).toBe(true))
  return wrapper
}

const states = (wrapper: Awaited<ReturnType<typeof mountApp>>) =>
  wrapper.findAll('.state').map((s) => s.attributes('data-state'))

describe('App', () => {
  it('keeps the summary on both pages and switches them with Hosts | ARP', async () => {
    stubBackend({ netbox: ok(netboxResponse), status: ok(statusEntries) })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
    const active = () => wrapper.find('.switch-item.is-active').text()
    const summary = '5 machines · 8 guests (2 stopped) · 22 containers'

    expect(active()).toBe('Hosts')
    expect(document.title).toBe('Homelab · Hosts')
    expect(wrapper.find('.refresh-btn').exists()).toBe(true)

    window.location.hash = '#/arp'
    await vi.waitFor(() => expect(wrapper.find('.arp-page').exists()).toBe(true))
    expect(active()).toBe('ARP')
    expect(document.title).toBe('Homelab · ARP')
    expect(wrapper.find('.app-header').text()).toContain(summary)
    expect(wrapper.find('.refresh-btn').exists()).toBe(false)
    expect(wrapper.find('.arp-live').exists()).toBe(true)

    window.location.hash = ''
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
    expect(active()).toBe('Hosts')
    wrapper.unmount()
  })

  it('draws the topology on its own page and links devices between Hosts and Topology', async () => {
    window.location.hash = ''
    const body = { data: { ...netboxResponse.data, topology: topologyPayload } }
    stubBackend({ netbox: ok(body), status: ok(statusEntries) })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
    // Every fixture machine is cabled: each tile offers the jump to the diagram.
    const links = wrapper.findAll('.topology-link')
    expect(links).toHaveLength(5)
    expect(links[0].attributes('href')).toMatch(/^#\/topology\?focus=\d+$/)
    expect(links[0].attributes('title')).toBe('Show on topology')

    window.location.hash = '#/topology'
    await vi.waitFor(() => expect(wrapper.findAll('.topo-card')).toHaveLength(7), { timeout: 4000 })
    expect(document.title).toBe('Homelab · Topology')
    expect(wrapper.find('.switch-item.is-active').text()).toBe('Topology')
    expect(wrapper.find('.refresh-btn').exists()).toBe(true)
    // Machines link back to their tile; the router and the switch are not clickable.
    const card = (id: string) => wrapper.find(`.topo-card[data-focus-device="${id}"]`)
    expect(card('11').element.tagName).toBe('A')
    expect(card('11').attributes('href')).toBe('#/?focus=11')
    expect(card('2').element.tagName).toBe('DIV')
    expect(card('2').findAll('.jack')).toHaveLength(6)
    expect(wrapper.find('.topo-legend').text()).toContain('20 servers')
    expect(wrapper.findAll('.speed-tag').map((t) => t.text()).sort()).toEqual(['100M', '10G', '2.5G'])
    wrapper.unmount()
    window.location.hash = ''
  })

  it('scrolls to and highlights the focused device, then drops the focus parameter', async () => {
    window.location.hash = '#/?focus=12'
    stubBackend({ netbox: ok(netboxResponse), status: ok(statusEntries) })
    const wrapper = await mountApp()
    const tile = () => wrapper.find('.machine-node[data-focus-device="12"]')
    await vi.waitFor(() => expect(tile().attributes('data-focus-flash')).toBe(''))
    await vi.waitFor(() => expect(window.location.hash).toBe('#/'), { timeout: 3000 })
    expect(tile().attributes('data-focus-flash')).toBeUndefined()

    window.location.hash = '#/?focus=nope' // unknown ids are ignored
    await vi.waitFor(() => expect(wrapper.find('[data-focus-flash]').exists()).toBe(false))
    wrapper.unmount()
    window.location.hash = ''
  }, 10000)

  it('renders the tree and fills in statuses', async () => {
    stubBackend({ netbox: ok(netboxResponse), status: ok(statusEntries) })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))

    expect(wrapper.findAll('.guest-node')).toHaveLength(8)
    expect(wrapper.findAll('.container-node')).toHaveLength(22)
    expect(wrapper.text()).toContain('5 machines · 8 guests (2 stopped) · 22 containers')
    await vi.waitFor(() => expect(states(wrapper)).not.toContain('pending'))
    expect(states(wrapper)).toContain('up')
    expect(wrapper.text()).not.toContain('unavailable')
    expect(wrapper.text()).not.toContain('/24')

    const findContainer = (name: string) =>
      wrapper.findAll('.container-node').find((c) => c.find('.container-name').text() === name)

    const metricsDb = findContainer('metrics-db')
    expect(metricsDb?.classes()).toContain('state-up')
    expect(metricsDb?.attributes('title')).toContain('Up 4 days (healthy)')

    const authDb = findContainer('auth-db')
    expect(authDb?.classes()).toContain('state-up')
    expect(authDb?.attributes('title')).toContain('Up 3 days (healthy)')

    const authCache = findContainer('auth-cache')
    expect(authCache?.classes()).toContain('state-up')
    expect(authCache?.attributes('title')).toContain('Up 3 days (healthy)')

    const authWorker = findContainer('auth-worker')
    expect(authWorker?.classes()).toContain('state-up')
    expect(authWorker?.attributes('title')).toContain('Up 3 days (healthy)')

    const findGuest = (name: string) =>
      wrapper.findAll('.guest-node').find((g) => g.find('.guest-name').text() === name)

    expect(findGuest('lxc-bastion')?.classes()).toContain('state-up')
    expect(findGuest('vm-worker')?.classes()).toContain('state-up')
    expect(findGuest('lxc-gateway-st')?.classes()).toContain('state-stopped')

    const findMachine = (name: string) =>
      wrapper.findAll('.machine-node').find((m) => m.find('.host-name').text() === name)

    const alpha = findMachine('node-alpha')
    expect(alpha?.findAll('.metric-spark')).toHaveLength(2)
    expect(alpha?.find('.metric-pct').text()).not.toBe('—')

    const beta = findMachine('node-beta')
    expect(beta?.findAll('.metric-spark')).toHaveLength(2)

    const gamma = findMachine('node-gamma')
    expect(gamma?.findAll('.metric-spark')).toHaveLength(2)

    const storage = findMachine('storage-nas')
    expect(storage?.find('.host-metrics').exists()).toBe(false)

    const print = findMachine('host-print')
    expect(print?.find('.host-metrics').exists()).toBe(false)
    expect(print?.find('.empty').text()).toBe('No VMs or containers registered in NetBox')
  })

  it('keeps the tree and says so when only the container status service fails', async () => {
    stubBackend({ netbox: ok(netboxResponse), status: ok(statusEntries), containerStatus: down })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Live container states are unavailable'))

    expect(wrapper.findAll('.machine-node')).toHaveLength(5)
    expect(wrapper.find('.error-page').exists()).toBe(false)
    expect(states(wrapper)).toContain('up')
  })

  it('Refresh (the binary clock) sends only POST /api/refresh; the page makes no other request', async () => {
    const fetchMock = stubBackend({ netbox: ok(netboxResponse), status: ok(statusEntries) })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.findAll('.refresh-btn .bit')).toHaveLength(9)
    expect(wrapper.find('.refresh-btn').attributes('aria-label')).toMatch(/^Refresh, data \d+ s old, updated \d\d:\d\d:\d\d$/)
    expect(wrapper.find('.refresh-btn .updated-time').text()).toMatch(/^\d\d:\d\d:\d\d$/)
    expect(wrapper.find('.app-header').text()).not.toMatch(/rendered/i)
    await wrapper.find('.refresh-btn .updated-time').trigger('click') // anywhere in the block
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe(REFRESH_URL)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })

  it('keeps the tree and says so when only Proxmox fails', async () => {
    stubBackend({
      netbox: ok(netboxResponse),
      status: ok(statusEntries),
      proxmoxResources: down,
    })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Proxmox data is unavailable'))

    expect(wrapper.findAll('.machine-node')).toHaveLength(5)
    expect(wrapper.find('.error-page').exists()).toBe(false)
  })

  it('shows the tree with pending statuses while the status service is slow', async () => {
    const slow = deferred()
    stubBackend({
      netbox: ok(netboxResponse),
      status: async () => {
        await slow.gate
        return ok(statusEntries)()
      },
    })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
    expect(states(wrapper)).toContain('pending')
    expect(states(wrapper)).toContain('stopped')

    slow.release()
    await vi.waitFor(() => expect(states(wrapper)).not.toContain('pending'))
    expect(states(wrapper)).toContain('up')
  })

  it('shows a skeleton while the inventory is slow', async () => {
    const slow = deferred()
    stubBackend({
      netbox: async () => {
        await slow.gate
        return ok(netboxResponse)()
      },
      status: ok(statusEntries),
    })
    const wrapper = await mountApp()
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.find('.machine-node').exists()).toBe(false)

    slow.release()
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
  })

  it('shows an error page with retry when NetBox is unreachable', async () => {
    let netbox: Handler = down
    stubBackend({ netbox: () => netbox(), status: ok(statusEntries) })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.find('.error-page').exists()).toBe(true))
    expect(wrapper.find('.error-page').text()).toContain('NetBox is unreachable.')
    expect(wrapper.find('.machine-node').exists()).toBe(false)

    netbox = ok(netboxResponse)
    await wrapper.find('.error-page button').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
    expect(wrapper.find('.error-page').exists()).toBe(false)
  })

  it('keeps the tree and says so when live statuses fail', async () => {
    stubBackend({
      netbox: ok(netboxResponse),
      status: down,
      containerStatus: down,
      proxmoxResources: down,
    })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Live statuses are unavailable'))
    expect(wrapper.text()).toContain('Live container states are unavailable')
    expect(wrapper.text()).toContain('Proxmox data is unavailable')

    expect(wrapper.findAll('.machine-node')).toHaveLength(5)
    expect(wrapper.find('.error-page').exists()).toBe(false)
    expect(states(wrapper)).not.toContain('up')
    expect(states(wrapper)).not.toContain('pending')
    expect(states(wrapper)).toContain('unknown')
    expect(states(wrapper)).toContain('stopped')
  })

  it('shows an empty message for an empty inventory', async () => {
    const empty = { data: { device_list: [], virtual_machine_list: [], service_list: [] } }
    stubBackend({ netbox: ok(empty), status: ok([]) })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.text()).toContain('NetBox returned no machines or containers.'))
    expect(wrapper.find('.error-page').exists()).toBe(false)
  })

  it('keeps the last tree when a refresh fails', async () => {
    let netbox: Handler = ok(netboxResponse)
    stubBackend({ netbox: () => netbox(), status: ok(statusEntries) })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
    await vi.waitFor(() => expect(wrapper.find('.refresh-btn').attributes('disabled')).toBeUndefined())

    netbox = down
    await wrapper.find('.refresh-btn').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('could not be refreshed'))
    await flushPromises()
    expect(wrapper.findAll('.machine-node')).toHaveLength(5)
    expect(wrapper.find('.error-page').exists()).toBe(false)
  })

  it('does not clear data or show pending while a refresh is in flight', async () => {
    let refreshGate = async () => {}
    stubBackend({
      netbox: ok(netboxResponse),
      status: ok(statusEntries),
      refreshGate: () => refreshGate(),
    })

    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
    await vi.waitFor(() => expect(states(wrapper)).not.toContain('pending'))

    const findGuest = (name: string) =>
      wrapper.findAll('.guest-node').find((g) => g.find('.guest-name').text() === name)
    const findMachine = (name: string) =>
      wrapper.findAll('.machine-node').find((m) => m.find('.host-name').text() === name)

    expect(findGuest('lxc-bastion')?.classes()).toContain('state-up')
    expect(findGuest('vm-worker')?.classes()).toContain('state-up')
    expect(findMachine('node-alpha')?.findAll('.metric-spark')).toHaveLength(2)

    // Trigger a refresh that the backend answers slowly
    const slow = deferred()
    refreshGate = () => slow.gate

    await wrapper.find('.refresh-btn').trigger('click')
    // During manual refresh, button shows progress
    expect(wrapper.find('.refresh-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.refresh-btn').attributes('aria-busy')).toBe('true')

    // Data MUST NOT be cleared while refresh is in flight!
    expect(findGuest('lxc-bastion')?.classes()).toContain('state-up')
    expect(findGuest('vm-worker')?.classes()).toContain('state-up')
    expect(findMachine('node-alpha')?.findAll('.metric-spark')).toHaveLength(2)
    expect(states(wrapper)).not.toContain('pending')

    slow.release()
    await vi.waitFor(() =>
      expect(wrapper.find('.refresh-btn').attributes('disabled')).toBeUndefined(),
    )
    expect(findGuest('lxc-bastion')?.classes()).toContain('state-up')
    expect(findGuest('vm-worker')?.classes()).toContain('state-up')
    expect(findMachine('node-alpha')?.findAll('.metric-spark')).toHaveLength(2)
  })

  it('keeps last Proxmox data, states, and graphs when Proxmox refresh fails', async () => {
    stubBackend({
      netbox: ok(netboxResponse),
      status: ok(statusEntries),
    })

    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
    await vi.waitFor(() => expect(states(wrapper)).not.toContain('pending'))

    const findGuest = (name: string) =>
      wrapper.findAll('.guest-node').find((g) => g.find('.guest-name').text() === name)
    const findMachine = (name: string) =>
      wrapper.findAll('.machine-node').find((m) => m.find('.host-name').text() === name)

    expect(findGuest('lxc-bastion')?.classes()).toContain('state-up')
    expect(findGuest('vm-worker')?.classes()).toContain('state-up')
    expect(findMachine('node-alpha')?.findAll('.metric-spark')).toHaveLength(2)

    // The backend's next Proxmox poll fails
    FakeEventSource.latest().emit('proxmox', sourceStatus('error', 'Proxmox is unreachable.'))

    // Notice banner must say showing last known data
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Proxmox data could not be refreshed; showing last known data'),
    )

    // But data is retained: bastion/worker are STILL up, node-alpha STILL has graphs!
    expect(findGuest('lxc-bastion')?.classes()).toContain('state-up')
    expect(findGuest('vm-worker')?.classes()).toContain('state-up')
    expect(findMachine('node-alpha')?.findAll('.metric-spark')).toHaveLength(2)
    expect(wrapper.findAll('.machine-node')).toHaveLength(5)
  })

  it('shows "showing last known data" notice when statuses or container states fail on refresh', async () => {
    let statusHandler: Handler = ok(statusEntries)
    let containerHandler: Handler = ok(containerStatusEntries)
    stubBackend({
      netbox: ok(netboxResponse),
      status: () => statusHandler(),
      containerStatus: () => containerHandler(),
    })

    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))

    // Fail both on refresh
    statusHandler = down
    containerHandler = down
    await wrapper.find('.refresh-btn').trigger('click')

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Live statuses could not be refreshed; showing last known data')
      expect(wrapper.text()).toContain('Live container states could not be refreshed; showing last known data')
    })
  })

  it('shows one "no connection" notice and no live state while the stream is down', async () => {
    stubBackend({ netbox: ok(netboxResponse), status: ok(statusEntries) })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
    await vi.waitFor(() => expect(states(wrapper)).toContain('up'))
    expect(wrapper.find('.offline-banner').exists()).toBe(false)
    const stoppedBefore = states(wrapper).filter((s) => s === 'stopped').length

    // The tunnel goes down: the browser keeps retrying a dropped connection.
    FakeEventSource.latest().fail(false)

    await vi.waitFor(() => expect(wrapper.find('.offline-banner').exists()).toBe(true))
    expect(wrapper.findAll('.notice')).toHaveLength(1)
    expect(wrapper.text()).toContain('No connection to the status backend')
    expect(wrapper.text()).not.toContain('could not be refreshed')
    expect(states(wrapper)).not.toContain('up')
    expect(states(wrapper)).not.toContain('down')
    expect(states(wrapper).filter((s) => s === 'stopped')).toHaveLength(stoppedBefore)
    expect(wrapper.find('main').classes()).toContain('is-offline')
    expect(wrapper.findAll('.machine-node')).toHaveLength(5)

    // The connection returns and the backend re-sends every source's state.
    FakeEventSource.latest().open()
    await vi.waitFor(() => expect(wrapper.find('.offline-banner').exists()).toBe(false))
    expect(states(wrapper)).toContain('up')
    expect(wrapper.find('main').classes()).not.toContain('is-offline')
  })

  describe('Stored inventory & NetBox offline resilience', () => {
    it('uses stored inventory on NetBox failure and shows notice with timestamp', async () => {
      const normalized = normalizeInventory(netboxResponse.data!)
      const storedTime = new Date('2026-10-02T14:30:00.000Z')
      localStorage.setItem(
        INVENTORY_STORAGE_KEY,
        JSON.stringify({
          version: INVENTORY_SCHEMA_VERSION,
          inventory: normalized,
          timestamp: storedTime.toISOString(),
        }),
      )

      // NetBox cannot be reached (e.g. NETBOX_URL pointing nowhere)
      stubBackend({
        netbox: down,
        status: ok(statusEntries),
      })

      const wrapper = await mountApp()
      // Tree is rendered immediately from storage!
      await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
      expect(wrapper.find('.error-page').exists()).toBe(false)

      // Notice says the inventory is from <time>
      await vi.waitFor(() => {
        expect(wrapper.text()).toContain('inventory is from')
        expect(wrapper.text()).toContain('NetBox is unreachable')
      })

      // Live sources loaded as usual!
      const findGuest = (name: string) =>
        wrapper.findAll('.guest-node').find((g) => g.find('.guest-name').text() === name)
      expect(findGuest('lxc-bastion')?.classes()).toContain('state-up')
      expect(findGuest('vm-worker')?.classes()).toContain('state-up')
    })

    it('replaces stored inventory on success without notice', async () => {
      const olderTime = new Date('2026-10-01T10:00:00.000Z')
      localStorage.setItem(
        INVENTORY_STORAGE_KEY,
        JSON.stringify({
          version: INVENTORY_SCHEMA_VERSION,
          inventory: {
            devices: [{ id: '99', name: 'old-box', roleSlug: 'server', offline: false, tags: [], hardware: {} }],
            vms: [],
            services: [],
          },
          timestamp: olderTime.toISOString(),
        }),
      )

      stubBackend({
        netbox: ok(netboxResponse),
        status: ok(statusEntries),
      })

      const wrapper = await mountApp()
      // Fresh inventory arrives and replaces old
      await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))
      expect(wrapper.text()).not.toContain('old-box')
      expect(wrapper.text()).not.toContain('inventory is from')
      expect(wrapper.find('.error-page').exists()).toBe(false)
    })

    it('ignores stored inventory of another schema version and shows error page when NetBox fails', async () => {
      localStorage.setItem(
        INVENTORY_STORAGE_KEY,
        JSON.stringify({
          version: 999, // incompatible schema version
          inventory: {
            devices: [{ id: '99', name: 'old-box', roleSlug: 'server', offline: false, tags: [], hardware: {} }],
            vms: [],
            services: [],
          },
          timestamp: '2026-10-01T10:00:00.000Z',
        }),
      )

      stubBackend({
        netbox: down,
        status: ok(statusEntries),
      })

      const wrapper = await mountApp()
      // Outdated version ignored -> falls back to error page because no valid stored inventory exists
      await vi.waitFor(() => expect(wrapper.find('.error-page').exists()).toBe(true))
      expect(wrapper.find('.machine-node').exists()).toBe(false)
    })

    it('ignores invalid or corrupt shape in storage and shows error page when NetBox fails', async () => {
      localStorage.setItem(INVENTORY_STORAGE_KEY, '{ corrupt-json')

      stubBackend({
        netbox: down,
        status: ok(statusEntries),
      })

      const wrapper = await mountApp()
      // Corrupt storage ignored -> falls back to error page because no valid stored inventory exists
      await vi.waitFor(() => expect(wrapper.find('.error-page').exists()).toBe(true))
      expect(wrapper.find('.machine-node').exists()).toBe(false)
    })
  })

  describe('Rule 1: live data beats offline in the tree', () => {
    it('renders a guest as up when NetBox says offline but Proxmox says running', async () => {
      // In netboxResponse, lxc-gateway-st is offline in NetBox
      // If Proxmox resources has lxc-gateway-st as running:
      const updatedProxmoxResources = proxmoxResources.map((res) =>
        'name' in res && res.name === 'lxc-gateway-st' ? { ...res, status: 'running' as const } : res,
      )

      stubBackend({
        netbox: ok(netboxResponse),
        status: ok(statusEntries),
        proxmoxResources: ok({ data: updatedProxmoxResources }),
      })

      const wrapper = await mountApp()
      await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))

      const findGuest = (name: string) =>
        wrapper.findAll('.guest-node').find((g) => g.find('.guest-name').text() === name)

      // lxc-gateway-st is offline in NetBox, but Proxmox says running -> UP!
      expect(findGuest('lxc-gateway-st')?.classes()).toContain('state-up')
    })
  })

  describe('Stack frames and grouping', () => {
    it('frames and labels every stack (even 1-container) while standalone containers and apps stay bare', async () => {
      stubBackend({ netbox: ok(netboxResponse), status: ok(statusEntries) })
      const wrapper = await mountApp()
      await vi.waitFor(() => expect(wrapper.findAll('.machine-node')).toHaveLength(5))

      // Collect all stack labels on the page
      const labels = wrapper.findAll('.stack-label').map((l) => l.text().toLowerCase())

      // 1-container stacks that must be framed and labelled
      const expectedSingleStackLabels = [
        'tunnel',
        'telemetry-view',
        'ingress-proxy',
        'status-page',
        'auth-mcp',
        'analytics',
      ]
      for (const stackName of expectedSingleStackLabels) {
        expect(labels).toContain(stackName)
        const labelEl = wrapper.findAll('.stack-label').find((l) => l.text().toLowerCase() === stackName)
        const frameBox = labelEl?.element.closest('.stack-box.is-labeled')
        expect(frameBox).not.toBeNull()
        // Must be a 1-container frame
        expect(frameBox?.classList.contains('is-single')).toBe(true)
      }

      // Standalone containers that must NOT be framed or labelled
      const unstackedContainers = [
        'control-panel',
        'cluster-agent-auth',
        'cluster-agent-services',
      ]
      for (const name of unstackedContainers) {
        expect(labels).not.toContain(name.toLowerCase())
        const containerNode = wrapper
          .findAll('.container-node')
          .find((c) => c.find('.container-name').text() === name)
        expect(containerNode?.exists()).toBe(true)
        // Must NOT sit inside a .stack-box.is-labeled
        const parentStackBox = containerNode?.element.closest('.stack-box.is-labeled')
        expect(parentStackBox).toBeNull()
      }

      // Apps on machine must NOT be framed or labelled
      const machineApps = ['media-vault', 'sync-agent']
      for (const appName of machineApps) {
        expect(labels).not.toContain(appName.toLowerCase())
        const appNode = wrapper
          .findAll('.apps-grid .container-node')
          .find((c) => c.find('.container-name').text() === appName)
        expect(appNode?.exists()).toBe(true)
        const parentStackBox = appNode?.element.closest('.stack-box.is-labeled')
        expect(parentStackBox).toBeNull()
      }

      // Verify 1-container stacks share the 2-column grid in vm-control, vm-services, and vm-auth
      const findGuest = (name: string) =>
        wrapper.findAll('.guest-node').find((g) => g.find('.guest-name').text() === name)

      const control = findGuest('vm-control')
      const controlSinglesGrid = control?.find('.singles-grid')
      expect(controlSinglesGrid?.exists()).toBe(true)
      // Contains tunnel, telemetry-view, ingress-proxy (stack frames) and control-panel (bare)
      expect(controlSinglesGrid?.findAll('.stack-box.is-labeled.is-single')).toHaveLength(3)
      expect(controlSinglesGrid?.findAll('.container-node')).toHaveLength(4)

      const services = findGuest('vm-services')
      const servicesSinglesGrid = services?.find('.singles-grid')
      expect(servicesSinglesGrid?.exists()).toBe(true)
      // Contains analytics, status-page (stack frames) and cluster-agent-services (bare)
      expect(servicesSinglesGrid?.findAll('.stack-box.is-labeled.is-single')).toHaveLength(2)
      expect(servicesSinglesGrid?.findAll('.container-node')).toHaveLength(3)

      const auth = findGuest('vm-auth')
      const authSinglesGrid = auth?.find('.singles-grid')
      expect(authSinglesGrid?.exists()).toBe(true)
      // Contains auth-mcp (stack frame) and cluster-agent-auth (bare)
      expect(authSinglesGrid?.findAll('.stack-box.is-labeled.is-single')).toHaveLength(1)
      expect(authSinglesGrid?.findAll('.container-node')).toHaveLength(2)
    })
  })
})

