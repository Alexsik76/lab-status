<script setup lang="ts">
import { useId } from 'vue'

/**
 * Wraps an element and shows `text` next to it on hover or keyboard focus, with a quiet fade.
 * `above` is for places where a clipping container ends right below the element.
 */
withDefaults(
  defineProps<{ text: string; align?: 'center' | 'start'; side?: 'below' | 'above' }>(),
  { align: 'center', side: 'below' },
)
const id = useId()
</script>

<template>
  <span class="hover-tip" :class="[`align-${align}`, `side-${side}`]" tabindex="0" :aria-describedby="id">
    <slot />
    <span :id="id" class="tip" role="tooltip">{{ text }}</span>
  </span>
</template>

<style scoped>
.hover-tip {
  position: relative;
  cursor: help;
}
.hover-tip:focus-visible {
  outline: 1px solid var(--color-border-btn-hover);
  outline-offset: 1px;
  border-radius: var(--radius-xs);
}

.tip {
  position: absolute;
  z-index: 10;
  width: max-content;
  max-width: 260px;
  padding: 6px 9px;
  border: 1px solid var(--color-border-btn-hover);
  border-radius: var(--radius-sm);
  background: var(--color-bg-spine);
  box-shadow: 0 4px 14px oklch(0 0 0 / 0.35);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.4;
  letter-spacing: 0;
  text-align: left;
  white-space: normal;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.side-below .tip {
  top: calc(100% + 8px);
}
.side-above .tip {
  bottom: calc(100% + 6px);
}
.align-center .tip {
  left: 50%;
  transform: translate(-50%, -3px);
}
.align-start .tip {
  left: 0;
  transform: translateY(-3px);
}
.hover-tip:hover .tip,
.hover-tip:focus-visible .tip {
  opacity: 1;
  transition-delay: 0.25s;
}
.align-center:hover .tip,
.align-center:focus-visible .tip {
  transform: translate(-50%, 0);
}
.align-start:hover .tip,
.align-start:focus-visible .tip {
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .tip {
    transition: none;
  }
}
</style>
