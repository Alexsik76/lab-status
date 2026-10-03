<script setup lang="ts">
import LoadingSpinner from './LoadingSpinner.vue'

defineProps<{ message: string; retrying: boolean }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="error-page" role="alert">
    <div class="error-card">
      <div class="error-icon">!</div>
      <h2 class="error-title">The lab inventory could not be loaded</h2>
      <p class="error-message">{{ message }}</p>
      <button
        type="button"
        class="retry-btn"
        :disabled="retrying"
        @click="$emit('retry')"
      >
        <LoadingSpinner v-if="retrying" />
        <span>Try again</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.error-page {
  max-width: 32em;
  margin: 5rem auto;
  text-align: center;
  box-sizing: border-box;
  padding: 0 1rem;
}

.error-card {
  background: oklch(0.19 0.009 250);
  border: 1px solid oklch(0.28 0.01 250);
  border-radius: 8px;
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.error-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: oklch(0.22 0.04 27);
  border: 1px solid oklch(0.62 0.22 27);
  color: oklch(0.62 0.22 27);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 700;
  font-size: 18px;
}

.error-title {
  margin: 0;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 18px;
  font-weight: 600;
  color: oklch(0.93 0.006 250);
}

.error-message {
  margin: 0;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  color: oklch(0.6 0.012 250);
  line-height: 1.4;
}

.retry-btn {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: oklch(0.24 0.01 250);
  border: 1px solid oklch(0.32 0.01 250);
  border-radius: 4px;
  padding: 6px 16px;
  color: oklch(0.92 0.006 250);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.retry-btn:hover:not(:disabled) {
  background: oklch(0.28 0.01 250);
  border-color: oklch(0.4 0.01 250);
}

.retry-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
