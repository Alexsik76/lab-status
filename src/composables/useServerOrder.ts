import { ref, watch } from 'vue'
import type { Machine } from '../domain/model'

const STORAGE_KEY = 'homelab_server_order'

function loadSavedOrder(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveOrder(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // ignore in restricted environments
  }
}

export function useServerOrder(initialMachines: () => Machine[]) {
  const orderedMachines = ref<Machine[]>([])

  function applyOrder(machines: Machine[]): Machine[] {
    const saved = loadSavedOrder()
    if (!saved.length) return [...machines]

    const rankMap = new Map<string, number>()
    saved.forEach((id, idx) => rankMap.set(id, idx))

    return [...machines].sort((a, b) => {
      const rankA = rankMap.has(a.id) ? rankMap.get(a.id)! : 9999
      const rankB = rankMap.has(b.id) ? rankMap.get(b.id)! : 9999
      if (rankA !== rankB) return rankA - rankB
      return 0
    })
  }

  watch(
    initialMachines,
    (machines) => {
      orderedMachines.value = applyOrder(machines)
    },
    { immediate: true },
  )

  function moveMachine(oldIndex: number, newIndex: number) {
    if (oldIndex === newIndex) return
    const updated = [...orderedMachines.value]
    const [moved] = updated.splice(oldIndex, 1)
    if (!moved) return
    updated.splice(newIndex, 0, moved)
    orderedMachines.value = updated
    saveOrder(updated.map((m) => m.id))
  }

  function resetOrder() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    orderedMachines.value = [...initialMachines()]
  }

  return {
    orderedMachines,
    moveMachine,
    resetOrder,
  }
}
