import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { containerStatusEntries, netboxResponse, statusEntries } from './__fixtures__'
import App from './App.vue'
import { CONTAINER_STATUS_URL, NETBOX_GRAPHQL_URL, STATUS_URL } from './config'

afterEach(() => vi.unstubAllGlobals())

type Handler = () => Promise<Response>
const ok = (body: unknown) => async () => new Response(JSON.stringify(body))
const down: Handler = async () => Promise.reject(new TypeError('Failed to fetch'))

/** Controllable promise, to hold a response back and release it later. */
function deferred() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  return { gate, release }
}

function stubBackend(handlers: { netbox: Handler; status: Handler; containerStatus?: Handler }) {
  const containerStatusHandler = handlers.containerStatus ?? ok(containerStatusEntries)
  const fetchMock = vi.fn(async (url: string) => {
    if (url === NETBOX_GRAPHQL_URL) return handlers.netbox()
    if (url === STATUS_URL) return handlers.status()
    if (url === CONTAINER_STATUS_URL) return containerStatusHandler()
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

    const energyPostgres = findContainer('energy_postgres')
    expect(energyPostgres?.classes()).toContain('state-up')
    expect(energyPostgres?.attributes('title')).toContain('Up 4 days (healthy)')

    const netboxPostgres = findContainer('netbox-docker-postgres-1')
    expect(netboxPostgres?.classes()).toContain('state-up')
    expect(netboxPostgres?.attributes('title')).toContain('Up 3 days (healthy)')

    const netboxRedis = findContainer('netbox-docker-redis-1')
    expect(netboxRedis?.classes()).toContain('state-up')
    expect(netboxRedis?.attributes('title')).toContain('Up 3 days (healthy)')

    const netboxWorker = findContainer('netbox-docker-netbox-worker-1')
    expect(netboxWorker?.classes()).toContain('state-up')
    expect(netboxWorker?.attributes('title')).toContain('Up 3 days (healthy)')
  })

  it('keeps the tree and says so when only the container status service fails', async () => {
    stubBackend({ netbox: ok(netboxResponse), status: ok(statusEntries), containerStatus: down })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Live container states are unavailable'))

    expect(wrapper.findAll('.machine-node')).toHaveLength(5)
    expect(wrapper.find('.error-page').exists()).toBe(false)
    expect(states(wrapper)).toContain('up')
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
    stubBackend({ netbox: ok(netboxResponse), status: down, containerStatus: down })
    const wrapper = await mountApp()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Live statuses are unavailable'))
    expect(wrapper.text()).toContain('Live container states are unavailable')

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
})
