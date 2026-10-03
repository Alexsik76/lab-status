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
  border-radius: var(--radius-sm);
  border-left: 3px solid;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.4;
  box-sizing: border-box;
}

.warning {
  border-color: var(--color-notice-warn-border);
  background: var(--color-notice-warn-bg);
  color: var(--color-notice-warn-text);
}

.error {
  border-color: var(--color-notice-err-border);
  background: var(--color-notice-err-bg);
  color: var(--color-notice-err-text);
}
</style>
