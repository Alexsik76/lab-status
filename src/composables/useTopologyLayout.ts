import ELK from 'elkjs/lib/elk.bundled.js'
import { computed, shallowRef, watch, type Ref } from 'vue'
import type { TopologyGraph } from '../domain/topology'
import { layoutKey, readPlacement, toElkGraph, type ElkResult, type Placement } from '../presentation/topologyLayout'

export type LayoutPhase = 'idle' | 'running' | 'ready' | 'failed'

let elk: InstanceType<typeof ELK> | null = null

/** Lays a topology graph out with ELK. Re-runs only when the structure changes (`layoutKey`). */
export async function layoutTopology(graph: TopologyGraph): Promise<Placement> {
  elk ??= new ELK()
  const result = (await elk.layout(toElkGraph(graph) as Parameters<typeof elk.layout>[0])) as ElkResult
  return readPlacement(graph, result)
}

/**
 * Placement of the graph: the last result stays on screen while a new layout runs; status
 * or metrics changes (same structure) never trigger one.
 */
export function useTopologyLayout(graph: Readonly<Ref<TopologyGraph | null>>) {
  const placement = shallowRef<Placement | null>(null)
  const phase = shallowRef<LayoutPhase>('idle')
  const error = shallowRef<string | null>(null)
  const key = computed(() => (graph.value ? layoutKey(graph.value) : null))
  let run = 0

  watch(
    key,
    async (k) => {
      const g = graph.value
      if (k === null || !g) return
      const current = ++run
      phase.value = 'running'
      try {
        const result = await layoutTopology(g)
        if (current !== run) return
        placement.value = result
        error.value = null
        phase.value = 'ready'
      } catch (err) {
        if (current !== run) return
        error.value = err instanceof Error ? err.message : String(err)
        phase.value = 'failed'
      }
    },
    { immediate: true },
  )

  return { placement, phase, error }
}
