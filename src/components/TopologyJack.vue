<script setup lang="ts">
import { computed } from 'vue'
import type { CableKind } from '../domain/topology'
import { JACK_SIZE, type JackShape } from '../presentation/topologyLayout'

/**
 * A port socket as inline SVG: an RJ45 outline with its stepped latch notch, an SFP cage with
 * its opening, or a plain rectangle. Drawn with the notch / opening towards the cable (down on
 * the bottom edge, up on the top edge). Colours come from `--jack-color` (the cable's style).
 */
const props = defineProps<{ shape: JackShape; kind: CableKind; north: boolean }>()

const size = computed(() => JACK_SIZE[props.shape])
</script>

<template>
  <svg
    class="jack-svg"
    :class="`kind-${kind}`"
    :width="size.width"
    :height="size.height"
    :viewBox="`0 0 ${size.width} ${size.height}`"
    aria-hidden="true"
  >
    <g :transform="north ? `matrix(1 0 0 -1 0 ${size.height})` : undefined">
      <path
        v-if="shape === 'rj45'"
        class="body"
        d="M3.5 1 H26.5 Q29 1 29 3.5 V14.5 Q29 16.5 27 16.5 H21 V18.5 H18 V21 H12 V18.5 H9 V16.5 H3 Q1 16.5 1 14.5 V3.5 Q1 1 3.5 1 Z"
      />
      <template v-else-if="shape === 'sfp'">
        <rect class="body" x="1" y="1" width="34" height="16" rx="2" />
        <rect class="opening" x="6" y="5.5" width="24" height="7.5" rx="1" />
      </template>
      <rect v-else class="body" x="0.75" y="0.75" width="22.5" height="10.5" rx="2.5" />
    </g>
  </svg>
</template>

<style scoped>
.jack-svg {
  display: block;
  overflow: visible;
}
.body {
  fill: color-mix(in oklch, var(--jack-color) 30%, var(--color-bg-page));
  stroke: var(--jack-color);
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.opening {
  fill: var(--color-bg-page);
  stroke: var(--jack-color);
  stroke-width: 1;
}
.kind-trunk .body {
  fill: var(--color-bg-page);
}
.kind-unknown .body {
  fill: var(--color-bg-slot);
  stroke-dasharray: 2.5 2;
}
</style>
