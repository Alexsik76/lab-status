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
    const hostServices = makeVm({ id: 'host-1', name: 'vm-services', kind: 'KVM' })
    const hostAuth = makeVm({ id: 'host-2', name: 'vm-auth', kind: 'KVM' })

    // Containers sharing the alias 'cluster_agent'
    const agentServices = makeVm({
      id: 'agent-1',
      name: 'cluster-agent-services',
      alias: 'cluster_agent',
      hostId: 'host-1',
    })
    const agentAuth = makeVm({
      id: 'agent-2',
      name: 'cluster-agent-auth',
      alias: 'cluster_agent',
      hostId: 'host-2',
    })

    const inventory: Inventory = {
      devices: [],
      vms: [hostServices, hostAuth, agentServices, agentAuth],
      services: [],
    }

    const entries: DockerContainerEntry[] = [
      { env: 'vm-services', name: 'cluster_agent', state: 'running', status: 'Up 7 days' },
      { env: 'vm-auth', name: 'cluster_agent', state: 'running', status: 'Up 7 days' },
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

    const vmsByAlias = new Map(inventory.vms.map((vm) => [vm.alias, vm]))

    expect(matched.has(vmsByAlias.get('metrics_db')!.id)).toBe(true)
    expect(matched.has(vmsByAlias.get('auth-db')!.id)).toBe(true)
    expect(matched.has(vmsByAlias.get('auth-cache')!.id)).toBe(true)
    expect(matched.has(vmsByAlias.get('auth-worker')!.id)).toBe(true)
  })
})

describe('resolveContainerState', () => {
  it('prefers live data over offline: offline + live running -> up; offline + no live data -> stopped', () => {
    const vm = makeVm({ offline: true, alias: 'db' })
    const entry: DockerContainerEntry = {
      env: 'local',
      name: 'db',
      state: 'running',
      status: 'Up 10 hours',
    }

    // 1. offline + live running -> up
    expect(resolveContainerState(vm, [], entry)).toEqual({
      state: 'up',
      blinking: false,
      dockerStatus: 'Up 10 hours',
    })
    expect(resolveContainerState(vm, ['up'], entry)).toEqual({
      state: 'up',
      blinking: false,
      dockerStatus: 'Up 10 hours',
    })

    // 2. offline + no live data -> stopped
    expect(resolveContainerState(vm, [], null)).toEqual({
      state: 'stopped',
      blinking: false,
      dockerStatus: null,
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

  it('containers with no Docker entry keep the current rules (e.g. apps on a host machine)', () => {
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
  it('marks metrics-db, auth-system database, cache, and workers as up', () => {
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

    const metricsDb = findByName('metrics-db')
    expect(metricsDb).toBeDefined()
    expect(metricsDb?.state).toBe('up')
    expect(metricsDb?.blinking).toBe(false)
    expect(metricsDb?.dockerStatus).toBe('Up 4 days (healthy)')

    const authDb = findByName('auth-db')
    expect(authDb).toBeDefined()
    expect(authDb?.state).toBe('up')
    expect(authDb?.blinking).toBe(false)
    expect(authDb?.dockerStatus).toBe('Up 3 days (healthy)')

    const authCache = findByName('auth-cache')
    expect(authCache).toBeDefined()
    expect(authCache?.state).toBe('up')
    expect(authCache?.blinking).toBe(false)
    expect(authCache?.dockerStatus).toBe('Up 3 days (healthy)')

    const authCacheSec = findByName('auth-cache-secondary')
    expect(authCacheSec).toBeDefined()
    expect(authCacheSec?.state).toBe('up')
    expect(authCacheSec?.blinking).toBe(false)
    expect(authCacheSec?.dockerStatus).toBe('Up 3 days (healthy)')

    const authWorker = findByName('auth-worker')
    expect(authWorker).toBeDefined()
    expect(authWorker?.state).toBe('up')
    expect(authWorker?.blinking).toBe(false)
    expect(authWorker?.dockerStatus).toBe('Up 3 days (healthy)')
  })
})
