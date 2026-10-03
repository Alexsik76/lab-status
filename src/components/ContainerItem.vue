<script setup lang="ts">
import { computed } from 'vue'
import type { Container } from '../domain/model'
import { getNodePrimaryUrlAndPort } from '../domain/homelabUi'
import OsIcon from './OsIcon.vue'
import StateBadge from './StateBadge.vue'

const props = withDefaults(
  defineProps<{
    container: Container
    kind?: string
  }>(),
  { kind: 'container' },
)

const serviceInfo = computed(() => getNodePrimaryUrlAndPort(props.container.services))
const url = computed(() => serviceInfo.value.url)
const portText = computed(() => serviceInfo.value.portText)

const titleText = computed(() => {
  const parts = [props.container.name]
  if (props.container.image) parts.push(`image: ${props.container.image}`)
  if (serviceInfo.value.url) parts.push(serviceInfo.value.url)
  return parts.join(' | ')
})
</script>

<template>
  <component
    :is="url ? 'a' : 'div'"
    :href="url || undefined"
    :target="url ? '_blank' : undefined"
    :rel="url ? 'noopener noreferrer' : undefined"
    class="container-node"
    :class="[
      `state-${container.state}`,
      { 'is-clickable': !!url, 'has-image': !!container.image },
    ]"
    :title="titleText"
  >
    <div class="container-row">
      <StateBadge :state="container.state" variant="container" />
      <OsIcon
        os="docker"
        :size="14"
        :dim="container.state === 'stopped' || container.state === 'unknown'"
      />
      <span class="container-name">{{ container.name }}</span>
      <span v-if="portText" class="container-port">{{ portText }}</span>
      <span v-if="url" class="container-arrow">↗</span>
    </div>
    <span v-if="container.image" class="container-image">
      {{ container.image }}
    </span>
  </component>
</template>

<style scoped>
.container-node {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 4px 7px;
  border-radius: 4px;
  box-sizing: border-box;
  text-decoration: none;
  font-family: 'IBM Plex Mono', monospace;
  color: oklch(0.93 0.006 250);
  background: transparent;
  transition: background 0.12s ease;
  user-select: none;
}

.is-clickable {
  cursor: pointer;
}
.is-clickable:hover {
  background: oklch(0.29 0.012 250);
}

.container-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.container-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.3;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: oklch(0.93 0.006 250);
}

.container-port {
  font-size: 11px;
  color: oklch(0.58 0.012 250);
  flex: none;
}

.container-arrow {
  font-size: 13px;
  color: oklch(0.55 0.012 250);
  flex: none;
}

.container-image {
  padding-left: 31px;
  font-size: 11px;
  line-height: 1.25;
  color: oklch(0.5 0.01 250);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Down state styling */
.state-down {
  background: oklch(0.62 0.22 27);
  color: #ffffff;
}
.state-down .container-name,
.state-down .container-port,
.state-down .container-arrow,
.state-down .container-image {
  color: #ffffff;
}
.state-down.is-clickable:hover {
  background: oklch(0.68 0.22 27);
}

/* Stopped / unknown styling */
.state-stopped .container-name,
.state-unknown .container-name {
  color: oklch(0.66 0.01 250);
}
</style>
