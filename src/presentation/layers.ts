/**
 * Layers of the Topology page and their visibility. Each layer button cycles
 * shown -> grey -> hidden -> shown. A new layer (e.g. Zigbee) is one more entry in `LAYERS`.
 * Wired: cables, copper jacks, wired-only devices. Wi-Fi: radio ports, Wi-Fi lines and Wi-Fi
 * client cards (hidden takes them out of the layout).
 */

export type LayerState = 'shown' | 'grey' | 'hidden'

export const LAYERS = [
  { id: 'wired', label: 'Wired' },
  { id: 'wifi', label: 'Wi-Fi' },
] as const

export type LayerId = (typeof LAYERS)[number]['id']
export type LayerStates = Record<LayerId, LayerState>

export const LAYER_STORAGE_KEY = 'lab-status:topology-layers'
/** The Wi-Fi grid under the diagram: open ('1') or collapsed (default). */
export const WIFI_GRID_OPEN_KEY = 'lab-status:wifi-grid-open'

const ORDER: readonly LayerState[] = ['shown', 'grey', 'hidden']

export const nextLayerState = (state: LayerState): LayerState => ORDER[(ORDER.indexOf(state) + 1) % ORDER.length]

export const defaultLayerStates = (): LayerStates =>
  Object.fromEntries(LAYERS.map((l) => [l.id, 'shown'])) as LayerStates

/** Stored states, every unknown or missing layer shown; never throws (private mode, bad JSON). */
export function loadLayerStates(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): LayerStates {
  const states = defaultLayerStates()
  try {
    const raw = JSON.parse(storage?.getItem(LAYER_STORAGE_KEY) ?? 'null') as Record<string, unknown> | null
    for (const layer of LAYERS) {
      const value = raw?.[layer.id]
      if (typeof value === 'string' && (ORDER as readonly string[]).includes(value)) states[layer.id] = value as LayerState
    }
  } catch {
    /* defaults */
  }
  return states
}

export function saveLayerStates(states: LayerStates, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(LAYER_STORAGE_KEY, JSON.stringify(states))
  } catch {
    /* not remembered */
  }
}
