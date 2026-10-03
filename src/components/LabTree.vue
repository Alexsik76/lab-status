<script setup lang="ts">
import { ref } from 'vue'
import { useSortable } from '@vueuse/integrations/useSortable'
import type { LabTree } from '../domain/model'
import { useServerOrder } from '../composables/useServerOrder'
import ContainerItem from './ContainerItem.vue'
import MachineItem from './MachineItem.vue'

const props = defineProps<{ tree: LabTree }>()

const { orderedMachines } = useServerOrder(() => props.tree.machines)

const listRef = ref<HTMLUListElement | null>(null)

useSortable(listRef, orderedMachines, {
  animation: 200,
  handle: '.drag-handle',
  ghostClass: 'sortable-ghost',
  chosenClass: 'sortable-chosen',
  dragClass: 'sortable-drag',
})
</script>

<template>
  <ul ref="listRef" class="lab-tree" aria-label="Lab inventory">
    <MachineItem
      v-for="machine in orderedMachines"
      :key="machine.id"
      :machine="machine"
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
  border: 1px dashed var(--color-text-muted) !important;
}

:deep(.sortable-chosen) {
  cursor: grabbing;
}

:deep(.sortable-drag) {
  opacity: 0.95;
  box-shadow: 0 10px 25px var(--color-drag-shadow);
}

.unplaced {
  margin-top: 16px;
  padding: 14px 18px;
  background: var(--color-bg-tile);
  border: 1px dashed var(--color-border-dashed);
  border-radius: var(--radius-lg);
}

.unplaced-header {
  margin-bottom: 10px;
}

.unplaced-title {
  margin: 0 0 4px 0;
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.unplaced-desc {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-muted);
}

.unplaced-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 4px;
}
</style>
