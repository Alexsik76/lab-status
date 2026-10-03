<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import Sortable from 'sortablejs'
import type { LabTree } from '../domain/model'
import { useServerOrder } from '../composables/useServerOrder'
import ContainerItem from './ContainerItem.vue'
import MachineItem from './MachineItem.vue'

const props = defineProps<{ tree: LabTree }>()

const { orderedMachines, moveMachine } = useServerOrder(() => props.tree.machines)

const listRef = ref<HTMLUListElement | null>(null)
let sortable: Sortable | null = null

onMounted(() => {
  if (listRef.value) {
    sortable = Sortable.create(listRef.value, {
      animation: 200,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: (evt) => {
        const { oldIndex, newIndex } = evt
        if (oldIndex !== undefined && newIndex !== undefined && oldIndex !== newIndex) {
          moveMachine(oldIndex, newIndex)
        }
      },
    })
  }
})

onUnmounted(() => {
  if (sortable) {
    sortable.destroy()
    sortable = null
  }
})
</script>

<template>
  <ul ref="listRef" class="lab-tree" aria-label="Lab inventory">
    <MachineItem
      v-for="(machine, index) in orderedMachines"
      :key="machine.id"
      :machine="machine"
      :index="index"
    />
  </ul>

  <section v-if="tree.unplaced.length" class="unplaced">
    <div class="unplaced-header">
      <h2 class="unplaced-title">Not placed</h2>
      <p class="unplaced-desc">These containers have no resolvable host in NetBox.</p>
    </div>
    <div class="unplaced-grid">
      <ContainerItem
        v-for="container in tree.unplaced"
        :key="container.id"
        :container="container"
      />
    </div>
  </section>
</template>

<style scoped>
.lab-tree {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

:deep(.sortable-ghost) {
  opacity: 0.35;
  border: 1px dashed oklch(0.55 0.01 250) !important;
}

:deep(.sortable-chosen) {
  cursor: grabbing;
}

:deep(.sortable-drag) {
  opacity: 0.95;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
}

.unplaced {
  margin-top: 16px;
  padding: 14px 18px;
  background: oklch(0.19 0.009 250);
  border: 1px dashed oklch(0.34 0.01 250);
  border-radius: 8px;
}

.unplaced-header {
  margin-bottom: 10px;
}

.unplaced-title {
  margin: 0 0 4px 0;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: oklch(0.85 0.006 250);
}

.unplaced-desc {
  margin: 0;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  color: oklch(0.55 0.012 250);
}

.unplaced-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 4px;
}
</style>
