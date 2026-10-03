import { describe, expect, it } from 'vitest'
import { matchDockerContainers } from './containerStatuses'
import { normalizeInventory } from './normalize'
import { mapMachineMetrics, matchProxmoxGuests } from './proxmox'
import { indexStatuses } from './statuses'
import { buildTree } from './tree'
import { INVENTORY_QUERY } from '../api/netbox'
import { CONTAINER_STATUS_URL, STATUS_URL } from '../config'

describe('live real data verification', () => {
  it('resolves real live containers, guests, and machine metrics', async () => {
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

    const [statusRes, containerRes, proxmoxRes] = await Promise.all([
      fetch(STATUS_URL).then((r) => r.json()),
      fetch(CONTAINER_STATUS_URL).then((r) => r.json()),
      fetch('http://localhost:5173/proxmox/api2/json/cluster/resources').then((r) => r.json()),
    ])

    const proxmoxNodes = proxmoxRes.data.filter((d: any) => d.type === 'node')
    const rrdEntries = await Promise.all(
      proxmoxNodes.map(async (n: any) => {
        const rrd = await fetch(
          `http://localhost:5173/proxmox/api2/json/nodes/${encodeURIComponent(n.node)}/rrddata?timeframe=hour&cf=AVERAGE`,
        ).then((r) => r.json())
        return [n.node, rrd.data ?? []] as const
      }),
    )
    const rrdByNode = Object.fromEntries(rrdEntries)

    const inventory = normalizeInventory(nbRes.data)
    const statusMap = indexStatuses(statusRes)
    const dockerIndex = matchDockerContainers(containerRes, inventory)
    const proxmoxGuests = matchProxmoxGuests(proxmoxRes.data, inventory)
    const machineMetrics = mapMachineMetrics(proxmoxRes.data, rrdByNode)

    const tree = buildTree(inventory, statusMap, dockerIndex, proxmoxGuests, machineMetrics)

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
    expect(energyPostgres?.state).toBe('up')
    expect(energyPostgres?.dockerStatus).toContain('healthy')

    const netboxPostgres = findByName('netbox-docker-postgres-1')
    expect(netboxPostgres?.state).toBe('up')

    const netboxWorker = findByName('netbox-docker-netbox-worker-1')
    expect(netboxWorker?.state).toBe('up')

    // Proxmox Guests Verification
    const allGuests = tree.machines.flatMap((m) => m.guests)
    const findGuest = (name: string) => allGuests.find((g) => g.name === name)

    const jump = findGuest('jump')
    expect(jump?.state).toBe('up')

    const agent = findGuest('agent')
    expect(agent?.state).toBe('up')

    const caddy = findGuest('caddy-st')
    expect(caddy?.state).toBe('stopped')

    // Proxmox Machines Verification
    const findMachine = (name: string) => tree.machines.find((m) => m.name === name)

    const prox1 = findMachine('prox1')
    expect(prox1?.metrics).toBeDefined()
    expect(prox1?.metrics?.cpu.currentPct).toMatch(/^\d+%$/)
    expect(prox1?.metrics?.cpu.spark).not.toBeNull()
    expect(prox1?.metrics?.mem.spark).not.toBeNull()

    const prox2 = findMachine('prox2')
    expect(prox2?.metrics).toBeDefined()
    expect(prox2?.metrics?.cpu.spark).not.toBeNull()

    const prox3 = findMachine('prox3')
    expect(prox3?.metrics).toBeDefined()
    expect(prox3?.metrics?.cpu.spark).not.toBeNull()

    const truenas = findMachine('truenas')
    expect(truenas?.metrics).toBeNull()

    const prints = findMachine('prints')
    expect(prints?.metrics).toBeNull()

    console.log('--- Real Live Verification Results ---')
    console.log('energy_postgres:', energyPostgres?.state, energyPostgres?.dockerStatus)
    console.log('netbox-docker-postgres-1:', netboxPostgres?.state)
    console.log('netbox-docker-netbox-worker-1:', netboxWorker?.state)
    console.log('Guest jump:', jump?.state)
    console.log('Guest agent:', agent?.state)
    console.log('Guest caddy-st:', caddy?.state)
    console.log('prox1 metrics:', prox1?.metrics?.cpu.currentPct, 'CPU,', prox1?.metrics?.mem.currentPct, 'MEM, spark:', !!prox1?.metrics?.cpu.spark)
    console.log('prox2 metrics:', prox2?.metrics?.cpu.currentPct, 'CPU,', prox2?.metrics?.mem.currentPct, 'MEM, spark:', !!prox2?.metrics?.cpu.spark)
    console.log('prox3 metrics:', prox3?.metrics?.cpu.currentPct, 'CPU,', prox3?.metrics?.mem.currentPct, 'MEM, spark:', !!prox3?.metrics?.cpu.spark)
    console.log('truenas metrics:', truenas?.metrics)
    console.log('prints metrics:', prints?.metrics)
  })
})
