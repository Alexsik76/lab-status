<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    os: string
    size?: number
    dim?: boolean
  }>(),
  {
    size: 20,
    dim: false,
  },
)

const BRAND: Record<string, { bg: string; fg: string }> = {
  proxmox: { bg: 'oklch(0.26 0.03 50)', fg: 'oklch(0.80 0.13 55)' },
  truenas: { bg: 'oklch(0.26 0.03 235)', fg: 'oklch(0.78 0.11 230)' },
  centos: { bg: 'oklch(0.26 0.02 300)', fg: 'oklch(0.75 0.10 300)' },
  debian: { bg: 'oklch(0.26 0.03 5)', fg: 'oklch(0.72 0.15 8)' },
  haos: { bg: 'oklch(0.30 0.06 225)', fg: 'oklch(0.80 0.11 225)' },
  docker: { bg: 'oklch(0.29 0.06 245)', fg: 'oklch(0.74 0.12 245)' },
}

const LOGO: Record<string, string> = {
  proxmox: '/assets/proxmox-mark.svg',
  truenas: '/assets/truenas.svg',
  centos: '/assets/centos.svg',
  debian: '/assets/debian-dark.svg',
}

const brand = computed(() => BRAND[props.os] ?? BRAND.debian)
const bg = computed(() => (props.dim ? 'oklch(0.25 0.01 250)' : brand.value.bg))
const fg = computed(() => (props.dim ? 'oklch(0.55 0.01 250)' : brand.value.fg))
const logoUrl = computed(() => LOGO[props.os] ?? null)
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
  >
    <img
      v-if="logoUrl"
      :src="logoUrl"
      :alt="os"
      class="os-logo-img"
      :style="{
        width: `${Math.round(size * 0.8)}px`,
        height: `${Math.round(size * 0.8)}px`,
        filter: dim ? 'grayscale(1) brightness(0.9)' : 'none',
        opacity: dim ? 0.65 : 1,
      }"
    />

    <svg
      v-else-if="os === 'haos'"
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
      v-else
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
