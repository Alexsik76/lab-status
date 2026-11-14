<script setup lang="ts">
import { computed } from 'vue'
import type { Container } from '../domain/model'
import { urlHostLabel } from '../presentation/hostLinks'
import { getNodePrimaryUrlAndPort, secondaryDirectUrl } from '../presentation/url'
import LinkOrPlain from './LinkOrPlain.vue'
import OsIcon from './OsIcon.vue'
import StateBadge from './StateBadge.vue'
import Tag from './Tag.vue'

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
/** Raw (ip:port) URL, linked separately only when the primary link is the public domain. */
const directUrl = computed(() => secondaryDirectUrl(serviceInfo.value))
const directTooltip = computed(() =>
  directUrl.value ? `Direct: ${urlHostLabel(directUrl.value)}` : undefined,
)

const titleText = computed(() => {
  const parts = [props.container.name]
  if (props.container.dockerStatus) parts.push(props.container.dockerStatus)
  if (props.container.image) parts.push(`image: ${props.container.image}`)
  const host = urlHostLabel(serviceInfo.value.url)
  if (host) parts.push(host)
  return parts.join(' | ')
})
</script>

<template>
  <div
    class="container-node"
    :class="[
      `state-${container.state}`,
      {
        'is-clickable': !!url,
        'has-image': !!container.image,
        'is-blinking': !!container.blinking,
      },
    ]"
    :title="titleText"
  >
    <div class="container-row">
      <StateBadge
        :state="container.state"
        variant="container"
        :blinking="container.blinking"
      />
      <OsIcon
        name="docker"
        :size="14"
        :dim="container.state === 'stopped' || container.state === 'unknown'"
      />
      <LinkOrPlain :href="url" as="span" class="container-name container-link" :title="titleText">
        {{ container.name }}
      </LinkOrPlain>
      <span v-if="container.tags?.length" class="container-tags">
        <Tag v-for="tag in container.tags" :key="tag.name" :tag="tag" size="sm" />
      </span>
      <span class="spacer"></span>
      <LinkOrPlain
        v-if="portText"
        :href="directUrl"
        as="span"
        class="container-port"
        :class="{ 'is-clickable': !!directUrl }"
        :title="directTooltip"
      >
        {{ portText }}
      </LinkOrPlain>
      <span v-if="url" class="container-arrow">↗</span>
    </div>
    <span v-if="container.image" class="container-image">
      {{ container.image }}
    </span>
  </div>
</template>

<style scoped>
.container-node {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 4px 7px;
  border-radius: var(--radius-sm);
  box-sizing: border-box;
  text-decoration: none;
  font-family: var(--font-mono);
  color: var(--color-text-primary);
  background: transparent;
  transition: background 0.12s ease;
  user-select: none;
}

.is-clickable {
  cursor: pointer;
}
.container-node.is-clickable {
  position: relative;
}

/* Primary link (public domain, else ip:port); stretched over the whole tile */
.container-link {
  text-decoration: none;
}
.container-link[href]::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}
.container-node.is-clickable:hover {
  background: var(--color-bg-hover);
}

.container-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.container-name {
  min-width: 0;
  font-size: 13px;
  line-height: 1.3;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-primary);
}

.container-tags {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.spacer {
  flex: 1;
}

.container-port {
  font-size: 11px;
  color: var(--color-text-port);
  flex: none;
}
/* Direct ip:port: secondary link that bypasses the reverse proxy, above the stretched one */
.container-port.is-clickable {
  position: relative;
  z-index: 1;
  text-decoration: none;
}
.container-port.is-clickable:hover,
.container-port.is-clickable:focus-visible {
  color: var(--color-text-white);
}

.container-arrow {
  font-size: 13px;
  color: var(--color-text-muted);
  flex: none;
}

.container-image {
  padding-left: 31px;
  font-size: 11px;
  line-height: 1.25;
  color: var(--color-text-image);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Down state styling */
.state-down {
  background: var(--color-state-down);
  color: var(--color-text-white);
}
.state-down .container-name,
.state-down .container-port,
.state-down .container-arrow,
.state-down .container-image {
  color: var(--color-text-white);
}
.state-down.is-clickable:hover {
  background: var(--color-state-down-hover);
}

/* Stopped / unknown styling */
.state-stopped .container-name {
  color: var(--color-text-stopped);
}
.state-unknown .container-name {
  color: var(--color-text-unknown);
}

.is-blinking {
  animation: blink-container 1.2s ease-in-out infinite;
}

@keyframes blink-container {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .is-blinking {
    animation: none;
  }
}
</style>
