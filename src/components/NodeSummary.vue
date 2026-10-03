<script setup lang="ts">
import type { State } from '../domain/model'
import StateBadge from './StateBadge.vue'

defineProps<{
  /** What the node is, e.g. "machine", "guest", "stack", "container". */
  kind: string
  name: string
  state: State
  details?: string[]
}>()
</script>

<template>
  <div class="summary">
    <span class="kind">{{ kind }}</span>
    <strong>{{ name }}</strong>
    <StateBadge :state="state" />
    <span v-if="details?.length" class="details">{{ details.join(' · ') }}</span>
  </div>
</template>

<style scoped>
.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5em;
}
.kind {
  font-size: 0.75em;
  text-transform: uppercase;
  color: #777;
}
.details {
  color: #555;
  font-size: 0.9em;
}
</style>
