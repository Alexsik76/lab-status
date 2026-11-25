<script setup lang="ts">
import { useDateFormat, useIntervalFn } from '@vueuse/core'
import { computed, ref } from 'vue'
import { ageSeconds, formatSince } from '../presentation/clock'
import NoticeBanner from './NoticeBanner.vue'

/**
 * The one notice while the status stream is down: since when, and that every state on the
 * page is the last known one, drawn as unknown. It replaces the per-source notices, which
 * would all say the same thing.
 */
const props = defineProps<{ since: Date }>()

const now = ref(Date.now())
useIntervalFn(() => (now.value = Date.now()), 15_000)
const time = useDateFormat(() => props.since, 'HH:mm')
const ago = computed(() => formatSince(ageSeconds(props.since, now.value) ?? 0))
</script>

<template>
  <NoticeBanner kind="error" class="offline-banner">
    <strong class="offline-title">No connection to the status backend</strong>
    since {{ time }} ({{ ago }}); reconnecting. Live states are unknown until it returns;
    metrics and the rest of the page are the last data received.
  </NoticeBanner>
</template>

<style scoped>
.offline-title {
  font-weight: 700;
  margin-right: 0.4em;
}
</style>
