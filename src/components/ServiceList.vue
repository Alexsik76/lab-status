<script setup lang="ts">
import type { ServiceItem } from '../domain/model'
import StateBadge from './StateBadge.vue'

defineProps<{ services: ServiceItem[] }>()
</script>

<template>
  <ul v-if="services.length" class="services" aria-label="Services">
    <li v-for="service in services" :key="service.id">
      <a v-if="service.url" :href="service.url" target="_blank" rel="noopener noreferrer">{{ service.name }}</a>
      <span v-else>{{ service.name }}</span>
      <StateBadge :state="service.state" />
      <span v-if="service.ports.length" class="meta">:{{ service.ports.join(', ') }}</span>
      <span v-if="service.error" class="meta" :title="service.error">{{ service.error }}</span>
    </li>
  </ul>
</template>

<style scoped>
.services {
  margin: 0.25em 0;
  padding-left: 1.2em;
  font-size: 0.9em;
}
.meta {
  color: #777;
  margin-left: 0.4em;
}
</style>
