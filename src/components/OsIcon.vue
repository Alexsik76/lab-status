<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { iconUrl } from '../presentation/icons'

const props = withDefaults(
  defineProps<{
    /** Dashboard Icons name from NetBox (custom field `icon`). */
    icon?: string | null
    /** Tooltip text, e.g. the platform name; the icon name when empty. */
    label?: string | null
    /** Built-in icon shown when there is no NetBox icon: server (machines, guests) or docker. */
    fallback?: 'server' | 'docker'
    size?: number
    dim?: boolean
  }>(),
  {
    icon: null,
    label: null,
    fallback: 'server',
    size: 20,
    dim: false,
  },
)

/** A NetBox icon that failed to load falls back to the built-in one. */
const failed = ref(false)
watch(
  () => props.icon,
  () => {
    failed.value = false
  },
)

const src = computed(() => (failed.value ? null : iconUrl(props.icon)))
const kind = computed<'image' | 'docker' | 'server'>(() => (src.value ? 'image' : props.fallback))
const title = computed(() => {
  if (kind.value === 'docker') return 'Docker'
  if (kind.value === 'image') return props.label || props.icon || ''
  return props.label || 'Server'
})

const THEMES = {
  image: { bg: 'oklch(0.25 0.01 250)', fg: '' },
  docker: { bg: 'oklch(0.29 0.06 245)', fg: 'oklch(0.74 0.12 245)' },
  server: { bg: 'oklch(0.27 0.01 250)', fg: 'oklch(0.70 0.012 250)' },
}

const bg = computed(() => (props.dim ? 'var(--color-icon-dim-bg)' : THEMES[kind.value].bg))
const fg = computed(() => (props.dim ? 'var(--color-icon-dim-fg)' : THEMES[kind.value].fg))
const borderRadius = computed(() => `${Math.max(3, Math.round(props.size / 4))}px`)
</script>

<template>
  <span
    class="os-icon-box"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      borderRadius,
      background: bg,
    }"
    :title="title"
  >
    <img
      v-if="kind === 'image' && src"
      :src="src"
      :alt="title"
      class="os-logo-img"
      loading="lazy"
      referrerpolicy="no-referrer"
      :style="{
        width: `${Math.round(size * 0.74)}px`,
        height: `${Math.round(size * 0.74)}px`,
        filter: dim ? 'grayscale(1) brightness(0.9)' : 'none',
        opacity: dim ? 0.65 : 1,
      }"
      @error="failed = true"
    />

    <svg
      v-else-if="kind === 'docker'"
      :width="size"
      :height="size"
      viewBox="0 0 16 16"
      class="os-svg"
    >
      <path
        d="M2.5 8.6 H13.2 C13 11.4 10.8 13 7.6 13 C4.6 13 3 11.2 2.5 8.6 Z"
        :fill="fg"
      />
      <rect x="3.6" y="6.2" width="2" height="2" rx="0.3" :fill="fg" />
      <rect x="5.9" y="6.2" width="2" height="2" rx="0.3" :fill="fg" />
      <rect x="8.2" y="6.2" width="2" height="2" rx="0.3" :fill="fg" />
      <rect x="5.9" y="3.9" width="2" height="2" rx="0.3" :fill="fg" />
    </svg>

    <svg v-else :width="size" :height="size" viewBox="0 0 16 16" class="os-svg">
      <rect x="3.5" y="3.5" width="9" height="3.6" rx="0.8" fill="none" :stroke="fg" stroke-width="1.2" />
      <rect x="3.5" y="8.9" width="9" height="3.6" rx="0.8" fill="none" :stroke="fg" stroke-width="1.2" />
      <circle cx="5.6" cy="5.3" r="0.75" :fill="fg" />
      <circle cx="5.6" cy="10.7" r="0.75" :fill="fg" />
    </svg>
  </span>
</template>

<style scoped>
.os-icon-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  overflow: hidden;
  user-select: none;
}

.os-logo-img {
  object-fit: contain;
  display: block;
}

.os-svg {
  display: block;
}
</style>
