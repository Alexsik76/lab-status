<script setup lang="ts">
import { computed } from 'vue'
import type { TagItem } from '../domain/model'

const props = withDefaults(
  defineProps<{
    tag: TagItem | string
    size?: 'sm' | 'md'
  }>(),
  {
    size: 'md',
  },
)

const name = computed(() => (typeof props.tag === 'string' ? props.tag : props.tag.name))
const hexColor = computed(() => {
  if (typeof props.tag === 'string') return null
  const c = props.tag.color
  if (!c) return null
  return c.startsWith('#') ? c : `#${c}`
})

const tagStyle = computed(() => {
  if (!hexColor.value) return undefined
  return {
    color: hexColor.value,
  }
})
</script>

<template>
  <span
    class="lab-tag"
    :class="`tag-${size}`"
    :title="name"
    :aria-label="name"
    :style="tagStyle"
  >
    <span aria-hidden="true">#</span>
    <span class="sr-only">{{ name }}</span>
  </span>
</template>

<style scoped>
.lab-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-weight: 600;
  line-height: 1;
  color: var(--color-tag-default-text);
  cursor: default;
  transition: opacity 0.12s ease, filter 0.12s ease;
  user-select: none;
  flex: none;
}

.tag-sm {
  font-size: 11px;
}

.tag-md {
  font-size: 13px;
}

.lab-tag:hover {
  filter: brightness(1.2);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
</style>
