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
  background: var(--color-bg-tile);
  border: 1px solid var(--color-border-guest);
  border-radius: var(--radius-lg);
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.error-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  background: var(--color-bg-guest-down);
  border: 1px solid var(--color-state-down);
  color: var(--color-state-down);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 18px;
}

.error-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.error-message {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.retry-btn {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--color-bg-spine-hover);
  border: 1px solid var(--color-border-slot);
  border-radius: var(--radius-sm);
  padding: 6px 16px;
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.retry-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
  border-color: var(--color-border-btn-hover);
}

.retry-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
