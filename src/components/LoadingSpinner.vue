<template>
  <span class="spinner" role="status" aria-label="Loading"></span>
</template>

<style scoped>
.spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  border: 2px solid var(--color-border-btn-hover);
  border-top-color: var(--color-state-up);
  border-radius: var(--radius-pill);
  vertical-align: -0.15em;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
