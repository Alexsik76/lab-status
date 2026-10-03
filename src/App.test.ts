import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  containerStatusEntries,
  netboxResponse,
  proxmoxResources,
  proxmoxRrdPoints,
  statusEntries,
} from './__fixtures__'
import App from './App.vue'
import {
  CONTAINER_STATUS_URL,
  NETBOX_GRAPHQL_URL,
  PROXMOX_CLUSTER_RESOURCES_URL,
  PROXMOX_NODES_URL,
  STATUS_URL,
} from './config'
import { INVENTORY_SCHEMA_VERSION, INVENTORY_STORAGE_KEY } from './composables/useInventory'
import { normalizeInventory } from './domain/normalize'

beforeEach(() => {
  localStorage.clear()
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
}) {
  const containerStatusHandler = handlers.containerStatus ?? ok(containerStatusEntries)
  const proxmoxResourcesHandler = handlers.proxmoxResources ?? ok({ data: proxmoxResources })
  const proxmoxRrdHandler = handlers.proxmoxRrd ?? ok({ data: proxmoxRrdPoints })

  const fetchMock = vi.fn(async (url: string) => {
    if (url === NETBOX_GRAPHQL_URL) return handlers.netbox()
    if (url === STATUS_URL) return handlers.status()
    if (url === CONTAINER_STATUS_URL) return containerStatusHandler()
    if (url === PROXMOX_CLUSTER_RESOURCES_URL) return proxmoxResourcesHandler()
    if (url.startsWith(PROXMOX_NODES_URL) && url.includes('/rrddata')) return proxmoxRrdHandler()
    throw new Error(`unexpected request ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function mountApp() {
  const wrapper = mount(App)
  await vi.waitFor(() => expect(wrapper.find('main').exists()).toBe(true))
  return wrapper
}

const states = (wrapper: Awaited<ReturnType<typeof mountApp>>) =>
  wrapper.findAll('.state').map((s) => s.attributes('data-state'))

describe('App', () => {
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
    expect(storage?.findAll('.metric-spark')).toHaveLength(0)
    expect(storage?.findAll('.slot-line')).toHaveLength(2)
    expect(storage?.find('.metric-pct').text()).toBe('—')

    const print = findMachine('host-print')
    expect(print?.findAll('.metric-spark')).toHaveLength(0)
    expect(print?.findAll('.slot-line')).toHaveLength(2)
    expect(print?.find('.metric-pct').text()).toBe('—')
  })

  it('keeps the tree and says so when only the container status service fails', async () => {
    stubBackend({ netbox: ok(netboxResponse), status: ok(statusEntries), containerStatus: down })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Live container states are unavailable'))

    expect(wrapper.findAll('.machine-node')).toHaveLength(5)
    expect(wrapper.find('.error-page').exists()).toBe(false)
    expect(states(wrapper)).toContain('up')
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
    await vi.waitFor(() => expect(wrapper.find('.toolbar button').attributes('disabled')).toBeUndefined())

    netbox = down
    await wrapper.find('.toolbar button').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('could not be refreshed'))
    await flushPromises()
    expect(wrapper.findAll('.machine-node')).toHaveLength(5)
    expect(wrapper.find('.error-page').exists()).toBe(false)
  })

  it('does not clear data or show pending while a refresh is in flight', async () => {
    let proxmoxResourcesHandler: Handler = ok({ data: proxmoxResources })
    stubBackend({
      netbox: ok(netboxResponse),
      status: ok(statusEntries),
      proxmoxResources: () => proxmoxResourcesHandler(),
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

    // Trigger a refresh with slow Proxmox response
    const slow = deferred()
    proxmoxResourcesHandler = async () => {
      await slow.gate
      return ok({ data: proxmoxResources })()
    }

    await wrapper.find('.toolbar button').trigger('click')
    // During manual refresh, button shows progress
    expect(wrapper.find('.toolbar button').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.toolbar button .spinner').exists()).toBe(true)

    // Data MUST NOT be cleared while refresh is in flight!
    expect(findGuest('lxc-bastion')?.classes()).toContain('state-up')
    expect(findGuest('vm-worker')?.classes()).toContain('state-up')
    expect(findMachine('node-alpha')?.findAll('.metric-spark')).toHaveLength(2)
    expect(states(wrapper)).not.toContain('pending')

    slow.release()
    await vi.waitFor(() =>
      expect(wrapper.find('.toolbar button').attributes('disabled')).toBeUndefined(),
    )
    expect(findGuest('lxc-bastion')?.classes()).toContain('state-up')
    expect(findGuest('vm-worker')?.classes()).toContain('state-up')
    expect(findMachine('node-alpha')?.findAll('.metric-spark')).toHaveLength(2)
  })

  it('keeps last Proxmox data, states, and graphs when Proxmox refresh fails', async () => {
    let proxmoxResourcesHandler: Handler = ok({ data: proxmoxResources })
    stubBackend({
      netbox: ok(netboxResponse),
      status: ok(statusEntries),
      proxmoxResources: () => proxmoxResourcesHandler(),
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

    // Proxmox now fails on refresh
    proxmoxResourcesHandler = down
    await wrapper.find('.toolbar button').trigger('click')

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
    await wrapper.find('.toolbar button').trigger('click')

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Live statuses could not be refreshed; showing last known data')
      expect(wrapper.text()).toContain('Live container states could not be refreshed; showing last known data')
    })
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

