<script setup lang="ts">
/** Placeholder machine tiles shown while the inventory is loading. */
const ROWS = [0, 1, 2]
</script>

<template>
  <div class="skeleton" aria-busy="true" aria-label="Loading inventory">
    <div v-for="row in ROWS" :key="row" class="skeleton-tile">
      <div class="skeleton-sidebar">
        <div class="shimmer-block title-shimmer"></div>
        <div class="shimmer-block meta-shimmer"></div>
        <div class="shimmer-block spark-shimmer"></div>
      </div>
      <div class="skeleton-content">
        <div v-for="c in 2" :key="c" class="skeleton-card">
          <div class="shimmer-block guest-shimmer"></div>
          <div class="shimmer-block container-shimmer"></div>
          <div class="shimmer-block container-shimmer"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.skeleton-tile {
  display: flex;
  box-sizing: border-box;
  background: var(--color-bg-tile);
  border: 1px solid var(--color-border-tile);
  border-radius: var(--radius-lg);
  overflow: hidden;
  height: 95px;
}

.skeleton-sidebar {
  flex: none;
  width: 250px;
  box-sizing: border-box;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--color-bg-spine);
  border-right: 1px solid var(--color-border-spine);
}

.skeleton-content {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 8px;
}

.skeleton-card {
  background: var(--color-bg-guest);
  border: 1px solid var(--color-border-guest);
  border-radius: var(--radius-md);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.shimmer-block {
  background: var(--color-bg-shimmer);
  border-radius: var(--radius-sm);
  animation: pulse 1.2s ease-in-out infinite;
}

.title-shimmer {
  width: 60%;
  height: 18px;
}
.meta-shimmer {
  width: 80%;
  height: 12px;
}
.spark-shimmer {
  width: 100%;
  height: 14px;
  margin-top: auto;
}

.guest-shimmer {
  width: 70%;
  height: 14px;
}
.container-shimmer {
  width: 90%;
  height: 12px;
}

@keyframes pulse {
  50% {
    opacity: 0.4;
  }
}

@media (max-width: 900px) {
  .skeleton-tile {
    height: auto;
    flex-direction: column;
  }
  .skeleton-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--color-border-spine);
  }
  .skeleton-content {
    grid-template-columns: 1fr;
  }
}
</style>
