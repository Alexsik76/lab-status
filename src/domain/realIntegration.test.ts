import { describe, expect, it } from 'vitest'
import { matchDockerContainers } from './containerStatuses'
import { normalizeInventory } from './normalize'
import { indexStatuses } from './statuses'
import { buildTree } from './tree'
import { INVENTORY_QUERY } from '../api/netbox'
import { CONTAINER_STATUS_URL, STATUS_URL } from '../config'

describe('live real data verification', () => {
  it('resolves real live containers with correct up states and docker statuses', async () => {
    let nbRes: any
    try {
      nbRes = await fetch('http://localhost:5173/netbox/graphql/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: INVENTORY_QUERY }),
      }).then((r) => r.json())
    } catch {
      console.log('Dev server not running at http://localhost:5173, skipping live verification')
      return
    }

    const [statusRes, containerRes] = await Promise.all([
      fetch(STATUS_URL).then((r) => r.json()),
      fetch(CONTAINER_STATUS_URL).then((r) => r.json()),
    ])

    const inventory = normalizeInventory(nbRes.data)
    const statusMap = indexStatuses(statusRes)
    const dockerIndex = matchDockerContainers(containerRes, inventory)
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
    expect(energyPostgres?.dockerStatus).toContain('healthy')

    const netboxPostgres = findByName('netbox-docker-postgres-1')
    expect(netboxPostgres).toBeDefined()
    expect(netboxPostgres?.state).toBe('up')
    expect(netboxPostgres?.dockerStatus).toContain('healthy')

    const netboxRedis = findByName('netbox-docker-redis-1')
    expect(netboxRedis).toBeDefined()
    expect(netboxRedis?.state).toBe('up')
    expect(netboxRedis?.dockerStatus).toContain('healthy')

    const netboxRedisCache = findByName('netbox-docker-redis-cache-1')
    expect(netboxRedisCache).toBeDefined()
    expect(netboxRedisCache?.state).toBe('up')
    expect(netboxRedisCache?.dockerStatus).toContain('healthy')

    const netboxWorker = findByName('netbox-docker-netbox-worker-1')
    expect(netboxWorker).toBeDefined()
    expect(netboxWorker?.state).toBe('up')
    expect(netboxWorker?.dockerStatus).toContain('healthy')

    console.log('Real Live Verification Results:')
    console.log('energy_postgres:', energyPostgres?.state, energyPostgres?.dockerStatus)
    console.log('netbox-docker-postgres-1:', netboxPostgres?.state, netboxPostgres?.dockerStatus)
    console.log('netbox-docker-redis-1:', netboxRedis?.state, netboxRedis?.dockerStatus)
    console.log('netbox-docker-redis-cache-1:', netboxRedisCache?.state, netboxRedisCache?.dockerStatus)
    console.log('netbox-docker-netbox-worker-1:', netboxWorker?.state, netboxWorker?.dockerStatus)
  })
})
