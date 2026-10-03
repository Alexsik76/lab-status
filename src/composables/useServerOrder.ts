import { ref, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import type { Machine } from '../domain/model'

const STORAGE_KEY = 'homelab_server_order'

export function useServerOrder(initialMachines: () => Machine[]) {
  const savedOrder = useLocalStorage<string[]>(STORAGE_KEY, [], { flush: 'sync' })
  const orderedMachines = ref<Machine[]>([])

  function applyOrder(machines: Machine[], order: string[]): Machine[] {
    if (!order || !order.length) return [...machines]

    const rankMap = new Map<string, number>()
    order.forEach((id, idx) => rankMap.set(id, idx))

    return [...machines].sort((a, b) => {
      const rankA = rankMap.has(a.id) ? rankMap.get(a.id)! : 9999
      const rankB = rankMap.has(b.id) ? rankMap.get(b.id)! : 9999
      if (rankA !== rankB) return rankA - rankB
      return 0
    })
  }

  watch(
    [initialMachines, savedOrder],
    ([machines, order]) => {
      orderedMachines.value = applyOrder(machines, order)
    },
    { immediate: true, deep: true },
  )

  watch(
    orderedMachines,
    (newList) => {
      if (!newList.length) return
      const currentIds = newList.map((m) => m.id)
      const existing = savedOrder.value
      if (
        currentIds.length !== existing.length ||
        currentIds.some((id, idx) => id !== existing[idx])
      ) {
        savedOrder.value = currentIds
      }
    },
    { deep: true, flush: 'sync' },
  )

  return {
    orderedMachines,
  }
}
