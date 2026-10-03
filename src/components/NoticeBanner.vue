<script setup lang="ts">
defineProps<{ kind?: 'warning' | 'error' }>()
</script>

<template>
  <p class="notice" :class="kind ?? 'warning'" role="alert"><slot /></p>
</template>

<style scoped>
.notice {
  margin: 8px 0;
  padding: 8px 12px;
  border-radius: 4px;
  border-left: 3px solid;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  line-height: 1.4;
  box-sizing: border-box;
}

.warning {
  border-color: oklch(0.75 0.15 65);
  background: oklch(0.20 0.04 65);
  color: oklch(0.88 0.06 65);
}

.error {
  border-color: oklch(0.62 0.22 27);
  background: oklch(0.20 0.04 27);
  color: oklch(0.90 0.06 27);
}
</style>
