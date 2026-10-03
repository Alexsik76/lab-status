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
    const list = [mockMachine('1', 'prox1'), mockMachine('2', 'prox2'), mockMachine('3', 'prox3')]
    const { orderedMachines } = useServerOrder(() => list)

    expect(orderedMachines.value.map((m) => m.name)).toEqual(['prox1', 'prox2', 'prox3'])
  })

  it('reorders machines and saves to localStorage', () => {
    const list = [mockMachine('1', 'prox1'), mockMachine('2', 'prox2'), mockMachine('3', 'prox3')]
    const { orderedMachines, moveMachine } = useServerOrder(() => list)

    moveMachine(0, 2)
    expect(orderedMachines.value.map((m) => m.name)).toEqual(['prox2', 'prox3', 'prox1'])

    const stored = JSON.parse(localStorage.getItem('homelab_server_order') || '[]')
    expect(stored).toEqual(['2', '3', '1'])
  })

  it('restores order from localStorage and appends new machines at the end', () => {
    localStorage.setItem('homelab_server_order', JSON.stringify(['3', '1']))
    const list = [
      mockMachine('1', 'prox1'),
      mockMachine('2', 'prox2'),
      mockMachine('3', 'prox3'),
    ]
    const { orderedMachines } = useServerOrder(() => list)

    expect(orderedMachines.value.map((m) => m.name)).toEqual(['prox3', 'prox1', 'prox2'])
  })
})
