<script setup lang="ts">
import { computed } from 'vue'
import { generateSparkPath } from '../domain/homelabUi'

const props = withDefaults(
  defineProps<{
    values: number[]
    width?: number
    height?: number
    color?: string
  }>(),
  {
    width: 50,
    height: 14,
    color: 'oklch(0.76 0.08 230)',
  },
)

const paths = computed(() => generateSparkPath(props.values, props.width, props.height))
</script>

<template>
  <svg
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    class="sparkline-svg"
  >
    <path
      v-if="paths.area"
      :d="paths.area"
      :fill="color"
      opacity="0.14"
    />
    <path
      v-if="paths.line"
      :d="paths.line"
      fill="none"
      :stroke="color"
      stroke-width="1.3"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
.sparkline-svg {
  display: block;
  flex: none;
}
</style>
