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
        <div v-for="c in 3" :key="c" class="skeleton-card">
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
  background: oklch(0.19 0.009 250);
  border: 1px solid oklch(0.25 0.01 250);
  border-radius: 8px;
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
  background: oklch(0.215 0.01 250);
  border-right: 1px solid oklch(0.26 0.01 250);
}

.skeleton-content {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 8px;
}

.skeleton-card {
  background: oklch(0.215 0.01 250);
  border: 1px solid oklch(0.28 0.01 250);
  border-radius: 6px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.shimmer-block {
  background: oklch(0.25 0.01 250);
  border-radius: 4px;
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
    border-bottom: 1px solid oklch(0.26 0.01 250);
  }
  .skeleton-content {
    grid-template-columns: 1fr;
  }
}
</style>
