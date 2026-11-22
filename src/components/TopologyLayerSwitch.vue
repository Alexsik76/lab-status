<script setup lang="ts">
import { LAYERS, nextLayerState, type LayerId, type LayerStates } from '../presentation/layers'

/** One button per layer, each cycling shown -> grey -> hidden. */
defineProps<{ states: LayerStates }>()
const emit = defineEmits<{ change: [id: LayerId, state: LayerStates[LayerId]] }>()

const NEXT_TEXT = { shown: 'grey it out', grey: 'hide it', hidden: 'show it' } as const
</script>

<template>
  <div class="layer-switch" role="group" aria-label="Layers">
    <button
      v-for="layer in LAYERS"
      :key="layer.id"
      type="button"
      class="layer-btn"
      :class="`is-${states[layer.id]}`"
      :data-layer="layer.id"
      :title="`${layer.label}: ${states[layer.id]} — click to ${NEXT_TEXT[states[layer.id]]}`"
      :aria-label="`${layer.label} layer, ${states[layer.id]}`"
      @click="emit('change', layer.id, nextLayerState(states[layer.id]))"
    >
      <span class="layer-mark" aria-hidden="true"></span>{{ layer.label }}
    </button>
  </div>
</template>

<style scoped>
.layer-switch {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}
.layer-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border: 1px solid var(--color-border-guest);
  border-radius: var(--radius-md);
  background: var(--color-bg-slot);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
.layer-btn:hover,
.layer-btn:focus-visible {
  border-color: var(--color-border-btn-hover);
  outline: none;
}
.layer-mark {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--color-state-up);
}
.is-grey {
  color: var(--color-text-dim);
}
.is-grey .layer-mark {
  background: var(--color-text-dim);
}
.is-hidden {
  color: var(--color-text-empty);
  text-decoration: line-through;
}
.is-hidden .layer-mark {
  background: transparent;
  border: 1.5px dashed var(--color-text-empty);
}
@media (prefers-reduced-motion: reduce) {
  .layer-btn {
    transition: none;
  }
}
</style>
