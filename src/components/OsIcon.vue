<script setup lang="ts">
import { computed } from 'vue'
import { platformToIcon, type PlatformIcon } from '../presentation/platform'

const props = withDefaults(
  defineProps<{
    platform?: string | null
    name?: string | null
    size?: number
    dim?: boolean
  }>(),
  {
    platform: null,
    name: null,
    size: 20,
    dim: false,
  },
)

interface IconConfig {
  kind: 'image' | 'svg'
  name: string
  alt: string
  src?: string
  bg: string
  fg: string
}

const BRAND_THEMES: Record<string, { bg: string; fg: string }> = {
  proxmox: { bg: 'oklch(0.26 0.03 50)', fg: 'oklch(0.80 0.13 55)' },
  truenas: { bg: 'oklch(0.26 0.03 235)', fg: 'oklch(0.78 0.11 230)' },
  debian: { bg: 'oklch(0.26 0.03 5)', fg: 'oklch(0.72 0.15 8)' },
  haos: { bg: 'oklch(0.30 0.06 225)', fg: 'oklch(0.80 0.11 225)' },
  docker: { bg: 'oklch(0.29 0.06 245)', fg: 'oklch(0.74 0.12 245)' },
}

const icon = computed<IconConfig | null>(() => {
  if (props.name === 'docker') {
    const theme = BRAND_THEMES.docker
    return { kind: 'svg', name: 'docker', alt: 'Docker', bg: theme.bg, fg: theme.fg }
  }

  const resolved: PlatformIcon | null = platformToIcon(props.platform)
  if (!resolved) return null

  const theme = BRAND_THEMES[resolved.name]
  if (!theme) return null

  return {
    kind: resolved.kind,
    name: resolved.name,
    alt: resolved.alt,
    src: resolved.src,
    bg: theme.bg,
    fg: theme.fg,
  }
})

const bg = computed(() => (props.dim ? 'var(--color-icon-dim-bg)' : icon.value?.bg))
const fg = computed(() => (props.dim ? 'var(--color-icon-dim-fg)' : icon.value?.fg))
const borderRadius = computed(() => `${Math.max(3, Math.round(props.size / 4))}px`)
</script>

<template>
  <span
    v-if="icon"
    class="os-icon-box"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      borderRadius,
      background: bg,
    }"
    :title="icon.alt"
  >
    <img
      v-if="icon.kind === 'image' && icon.src"
      :src="icon.src"
      :alt="icon.alt"
      class="os-logo-img"
      :style="{
        width: `${Math.round(size * 0.8)}px`,
        height: `${Math.round(size * 0.8)}px`,
        filter: dim ? 'grayscale(1) brightness(0.9)' : 'none',
        opacity: dim ? 0.65 : 1,
      }"
    />

    <svg
      v-else-if="icon.name === 'haos'"
      :width="size"
      :height="size"
      viewBox="0 0 16 16"
      class="os-svg"
      :style="{ borderRadius, background: bg }"
    >
      <path
        d="M3.5 8 L8 3.8 L12.5 8 V12.2 H3.5 Z"
        fill="none"
        :stroke="fg"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="8" cy="9" r="1.2" :fill="fg" />
    </svg>

    <svg
      v-else-if="icon.name === 'docker'"
      :width="size"
      :height="size"
      viewBox="0 0 16 16"
      class="os-svg"
      :style="{ borderRadius, background: bg }"
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
