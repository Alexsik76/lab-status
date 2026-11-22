import { describe, expect, it } from 'vitest'
import { LAYERS, LAYER_STORAGE_KEY, defaultLayerStates, loadLayerStates, nextLayerState, saveLayerStates } from './layers'

const memory = () => {
  const items = new Map<string, string>()
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items }
}

describe('layers', () => {
  it('cycles shown -> grey -> hidden -> shown', () => {
    expect(nextLayerState('shown')).toBe('grey')
    expect(nextLayerState('grey')).toBe('hidden')
    expect(nextLayerState('hidden')).toBe('shown')
  })

  it('defaults every layer to shown, and the list is the only place a layer is declared', () => {
    expect(LAYERS.map((l) => l.id)).toEqual(['wired', 'wifi', 'zigbee'])
    expect(defaultLayerStates()).toEqual({ wired: 'shown', wifi: 'shown', zigbee: 'shown' })
  })

  it('remembers the states, ignoring unknown values and broken storage', () => {
    const store = memory()
    saveLayerStates({ wired: 'grey', wifi: 'hidden', zigbee: 'grey' }, store)
    expect(JSON.parse(store.items.get(LAYER_STORAGE_KEY)!)).toEqual({ wired: 'grey', wifi: 'hidden', zigbee: 'grey' })
    expect(loadLayerStates(store)).toEqual({ wired: 'grey', wifi: 'hidden', zigbee: 'grey' })
    store.setItem(LAYER_STORAGE_KEY, '{"wired":"purple","lora":"grey","zigbee":"pink"}')
    expect(loadLayerStates(store)).toEqual({ wired: 'shown', wifi: 'shown', zigbee: 'shown' })
    store.setItem(LAYER_STORAGE_KEY, 'not json')
    expect(loadLayerStates(store)).toEqual({ wired: 'shown', wifi: 'shown', zigbee: 'shown' })
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(loadLayerStates(throwing)).toEqual({ wired: 'shown', wifi: 'shown', zigbee: 'shown' })
    expect(() => saveLayerStates({ wired: 'grey', wifi: 'grey', zigbee: 'grey' }, throwing)).not.toThrow()
  })
})
