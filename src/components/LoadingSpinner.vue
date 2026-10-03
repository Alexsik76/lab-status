<template>
  <span class="spinner" role="status" aria-label="Loading"></span>
</template>

<style scoped>
.spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  border: 2px solid oklch(0.35 0.01 250);
  border-top-color: oklch(0.78 0.14 155);
  border-radius: 50%;
  vertical-align: -0.15em;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
