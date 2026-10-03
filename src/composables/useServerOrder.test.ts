import { beforeEach, describe, expect, it } from 'vitest'
import { useServerOrder } from './useServerOrder'
import type { Machine } from '../domain/model'

function mockMachine(id: string, name: string): Machine {
  return {
    id,
    name,
    model: null,
    manufacturer: null,
    ip: null,
    platform: null,
    cluster: null,
    tags: [],
    hardware: { cpuCores: null, memoryGb: null, storageGb: null },
    services: [],
    guests: [],
    apps: [],
    state: 'up',
  }
}

describe('useServerOrder', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps original order when localStorage is empty', () => {
    const list = [mockMachine('1', 'server-a'), mockMachine('2', 'server-b'), mockMachine('3', 'server-c')]
    const { orderedMachines } = useServerOrder(() => list)

    expect(orderedMachines.value.map((m) => m.name)).toEqual(['server-a', 'server-b', 'server-c'])
  })

  it('reorders machines and saves to localStorage', () => {
    const list = [mockMachine('1', 'server-a'), mockMachine('2', 'server-b'), mockMachine('3', 'server-c')]
    const { orderedMachines } = useServerOrder(() => list)

    const updated = [...orderedMachines.value]
    const [moved] = updated.splice(0, 1)
    updated.splice(2, 0, moved)
    orderedMachines.value = updated
    expect(orderedMachines.value.map((m) => m.name)).toEqual(['server-b', 'server-c', 'server-a'])

    const stored = JSON.parse(localStorage.getItem('homelab_server_order') || '[]')
    expect(stored).toEqual(['2', '3', '1'])
  })

  it('restores order from localStorage and appends new machines at the end', () => {
    localStorage.setItem('homelab_server_order', JSON.stringify(['3', '1']))
    const list = [
      mockMachine('1', 'server-a'),
      mockMachine('2', 'server-b'),
      mockMachine('3', 'server-c'),
    ]
    const { orderedMachines } = useServerOrder(() => list)

    expect(orderedMachines.value.map((m) => m.name)).toEqual(['server-c', 'server-a', 'server-b'])
  })
})
