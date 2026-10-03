import { describe, expect, it } from 'vitest'
import { matchDockerContainers, resolveContainerState } from './containerStatuses'
import type { Inventory, VmRecord } from './model'
import type { DockerContainerEntry } from '../types/containerStatus'
import { containerStatusEntries, rawInventory, statusEntries } from '../__fixtures__'
import { normalizeInventory } from './normalize'
import { indexStatuses } from './statuses'
import { buildTree } from './tree'

function makeVm(partial: Partial<VmRecord>): VmRecord {
  return {
    id: 'vm-1',
    name: 'test-vm',
    alias: null,
    kind: 'Docker',
    offline: false,
    vcpus: null,
    memoryMb: null,
    disk: null,
    description: '',
    image: null,
    stack: null,
    cluster: null,
    platform: null,
    ip: null,
    tags: [],
    deviceId: null,
    hostId: null,
    ...partial,
  }
}

describe('matchDockerContainers', () => {
  it('matches NetBox container by alias equal to Docker entry name', () => {
    const inventory: Inventory = {
      devices: [],
      vms: [
        makeVm({ id: 'c-1', name: 'my-postgres', alias: 'db_postgres' }),
        makeVm({ id: 'c-2', name: 'my-redis', alias: 'cache_redis' }),
      ],
      services: [],
    }

    const entries: DockerContainerEntry[] = [
      { env: 'local', name: 'db_postgres', state: 'running', status: 'Up 2 hours' },
    ]

    const matched = matchDockerContainers(entries, inventory)
    expect(matched.size).toBe(1)
    expect(matched.get('c-1')).toEqual(entries[0])
    expect(matched.get('c-2')).toBeUndefined()
  })

  it('disambiguates containers sharing the same alias using host VM name equal to env', () => {
    // Host VMs
    const hostTreehouse = makeVm({ id: 'host-1', name: 'treehouse', kind: 'KVM' })
    const hostNetbox = makeVm({ id: 'host-2', name: 'netbox', kind: 'KVM' })

    // Containers sharing the alias 'portainer_agent'
    const agentTreehouse = makeVm({
      id: 'agent-1',
      name: 'portainer_agent-treehouse',
      alias: 'portainer_agent',
      hostId: 'host-1',
    })
    const agentNetbox = makeVm({
      id: 'agent-2',
      name: 'portainer_agent-netbox',
      alias: 'portainer_agent',
      hostId: 'host-2',
    })

    const inventory: Inventory = {
      devices: [],
      vms: [hostTreehouse, hostNetbox, agentTreehouse, agentNetbox],
      services: [],
    }

    const entries: DockerContainerEntry[] = [
      { env: 'treehouse', name: 'portainer_agent', state: 'running', status: 'Up 7 days' },
      { env: 'netbox', name: 'portainer_agent', state: 'running', status: 'Up 7 days' },
    ]

    const matched = matchDockerContainers(entries, inventory)
    expect(matched.get('agent-1')).toEqual(entries[0])
    expect(matched.get('agent-2')).toEqual(entries[1])
  })

  it('ignores Docker entries that have no matching NetBox container', () => {
    const inventory: Inventory = {
      devices: [],
      vms: [makeVm({ id: 'c-1', name: 'worker', alias: 'my_worker' })],
      services: [],
    }

    const entries: DockerContainerEntry[] = [
      { env: 'local', name: 'unknown_container', state: 'running', status: 'Up 1 day' },
    ]

    const matched = matchDockerContainers(entries, inventory)
    expect(matched.size).toBe(0)
  })

  it('matches all expected containers against real fixture inventory', () => {
    const inventory = normalizeInventory(rawInventory)
    const matched = matchDockerContainers(containerStatusEntries, inventory)

    // energy_postgres, netbox-docker-postgres-1, netbox-docker-redis-1, netbox-docker-netbox-worker-1
    const vmsByAlias = new Map(inventory.vms.map((vm) => [vm.alias, vm]))

    expect(matched.has(vmsByAlias.get('energy_postgres')!.id)).toBe(true)
    expect(matched.has(vmsByAlias.get('netbox-docker-postgres-1')!.id)).toBe(true)
    expect(matched.has(vmsByAlias.get('netbox-docker-redis-1')!.id)).toBe(true)
    expect(matched.has(vmsByAlias.get('netbox-docker-netbox-worker-1')!.id)).toBe(true)
  })
})

describe('resolveContainerState', () => {
  it('offline in NetBox still means stopped regardless of Docker state', () => {
    const vm = makeVm({ offline: true, alias: 'db' })
    const entry: DockerContainerEntry = {
      env: 'local',
      name: 'db',
      state: 'running',
      status: 'Up 10 hours',
    }

    const result = resolveContainerState(vm, ['up'], entry)
    expect(result).toEqual({
      state: 'stopped',
      blinking: false,
      dockerStatus: 'Up 10 hours',
    })
  })

  it('Docker state is anything but "running" -> stopped', () => {
    const vm = makeVm({ offline: false, alias: 'worker' })

    const states = ['exited', 'paused', 'restarting', 'created', 'dead'] as const
    for (const state of states) {
      const entry: DockerContainerEntry = {
        env: 'local',
        name: 'worker',
        state,
        status: `Exited (137) 5 minutes ago`,
      }
      const result = resolveContainerState(vm, ['up'], entry)
      expect(result).toEqual({
        state: 'stopped',
        blinking: false,
        dockerStatus: entry.status,
      })
    }
  })

  it('Docker running and HTTP check fails -> down: red and blinking', () => {
    const vm = makeVm({ offline: false, alias: 'api' })
    const entry: DockerContainerEntry = {
      env: 'local',
      name: 'api',
      state: 'running',
      status: 'Up 3 days',
    }

    const result = resolveContainerState(vm, ['down'], entry)
    expect(result).toEqual({
      state: 'down',
      blinking: true,
      dockerStatus: 'Up 3 days',
    })
  })

  it('Docker running and HTTP check passes -> up', () => {
    const vm = makeVm({ offline: false, alias: 'api' })
    const entry: DockerContainerEntry = {
      env: 'local',
      name: 'api',
      state: 'running',
      status: 'Up 3 days',
    }

    const result = resolveContainerState(vm, ['up'], entry)
    expect(result).toEqual({
      state: 'up',
      blinking: false,
      dockerStatus: 'Up 3 days',
    })
  })

  it('Docker running and HTTP check does not exist -> up', () => {
    const vm = makeVm({ offline: false, alias: 'postgres' })
    const entry: DockerContainerEntry = {
      env: 'local',
      name: 'postgres',
      state: 'running',
      status: 'Up 4 days (healthy)',
    }

    const result = resolveContainerState(vm, [], entry)
    expect(result).toEqual({
      state: 'up',
      blinking: false,
      dockerStatus: 'Up 4 days (healthy)',
    })
  })

  it('Docker running and HTTP checks are all unknown -> up', () => {
    const vm = makeVm({ offline: false, alias: 'postgres' })
    const entry: DockerContainerEntry = {
      env: 'local',
      name: 'postgres',
      state: 'running',
      status: 'Up 4 days (healthy)',
    }

    const result = resolveContainerState(vm, ['unknown'], entry)
    expect(result).toEqual({
      state: 'up',
      blinking: false,
      dockerStatus: 'Up 4 days (healthy)',
    })
  })

  it('containers with no Docker entry keep the current rules (e.g. apps on truenas)', () => {
    const vm = makeVm({ offline: false, alias: null })

    // No services -> unknown
    expect(resolveContainerState(vm, [])).toEqual({
      state: 'unknown',
      blinking: false,
      dockerStatus: null,
    })

    // Service passes -> up
    expect(resolveContainerState(vm, ['up'])).toEqual({
      state: 'up',
      blinking: false,
      dockerStatus: null,
    })

    // Service fails -> down
    expect(resolveContainerState(vm, ['down'])).toEqual({
      state: 'down',
      blinking: false,
      dockerStatus: null,
    })
  })
})

describe('buildTree with Docker statuses', () => {
  it('marks energy_postgres, netbox-docker database, cache, and workers as up', () => {
    const inventory = normalizeInventory(rawInventory)
    const statusMap = indexStatuses(statusEntries)
    const dockerIndex = matchDockerContainers(containerStatusEntries, inventory)

    const tree = buildTree(inventory, statusMap, dockerIndex)
    const allContainers = [
      ...tree.machines.flatMap((m) => [
        ...m.apps,
        ...m.guests.flatMap((g) => [
          ...g.standalone,
          ...g.stacks.flatMap((s) => s.containers),
        ]),
      ]),
      ...tree.unplaced,
    ]

    const findByName = (name: string) => allContainers.find((c) => c.name === name)

    const energyPostgres = findByName('energy_postgres')
    expect(energyPostgres).toBeDefined()
    expect(energyPostgres?.state).toBe('up')
    expect(energyPostgres?.blinking).toBe(false)
    expect(energyPostgres?.dockerStatus).toBe('Up 4 days (healthy)')

    const netboxPostgres = findByName('netbox-docker-postgres-1')
    expect(netboxPostgres).toBeDefined()
    expect(netboxPostgres?.state).toBe('up')
    expect(netboxPostgres?.blinking).toBe(false)
    expect(netboxPostgres?.dockerStatus).toBe('Up 3 days (healthy)')

    const netboxRedis = findByName('netbox-docker-redis-1')
    expect(netboxRedis).toBeDefined()
    expect(netboxRedis?.state).toBe('up')
    expect(netboxRedis?.blinking).toBe(false)
    expect(netboxRedis?.dockerStatus).toBe('Up 3 days (healthy)')

    const netboxRedisCache = findByName('netbox-docker-redis-cache-1')
    expect(netboxRedisCache).toBeDefined()
    expect(netboxRedisCache?.state).toBe('up')
    expect(netboxRedisCache?.blinking).toBe(false)
    expect(netboxRedisCache?.dockerStatus).toBe('Up 3 days (healthy)')

    const netboxWorker = findByName('netbox-docker-netbox-worker-1')
    expect(netboxWorker).toBeDefined()
    expect(netboxWorker?.state).toBe('up')
    expect(netboxWorker?.blinking).toBe(false)
    expect(netboxWorker?.dockerStatus).toBe('Up 3 days (healthy)')
  })
})
