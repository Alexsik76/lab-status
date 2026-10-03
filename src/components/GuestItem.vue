<script setup lang="ts">
import { computed } from 'vue'
import type { Container, Guest, Stack } from '../domain/model'
import { detectGuestOs, getNodePrimaryUrlAndPort } from '../domain/homelabUi'
import { formatMemory } from '../format'
import ContainerItem from './ContainerItem.vue'
import OsIcon from './OsIcon.vue'
import StateBadge from './StateBadge.vue'

const props = defineProps<{ guest: Guest }>()

const guestOs = computed(() => detectGuestOs(props.guest))
const displayKind = computed(() => (props.guest.kind === 'KVM' ? 'VM' : props.guest.kind))

const serviceInfo = computed(() =>
  getNodePrimaryUrlAndPort(props.guest.services, props.guest.ip),
)
const guestUrl = computed(() => serviceInfo.value.url)
const guestPort = computed(() => serviceInfo.value.portText)

const specs = computed(() => {
  const parts: string[] = []
  if (props.guest.vcpus !== null) parts.push(`${props.guest.vcpus} vCPU`)
  if (props.guest.memoryMb !== null) parts.push(formatMemory(props.guest.memoryMb))
  return parts.join(' · ')
})

const isEmpty = computed(
  () => props.guest.stacks.length === 0 && props.guest.standalone.length === 0,
)

interface DisplayStack {
  name: string
  labeled: boolean
  containers: Container[]
}

const displayStacks = computed<DisplayStack[]>(() => {
  const result: DisplayStack[] = []
  const singles: Container[] = [...props.guest.standalone]

  for (const s of props.guest.stacks) {
    if (s.containers.length > 1) {
      result.push({
        name: s.name,
        labeled: true,
        containers: s.containers,
      })
    } else {
      singles.push(...s.containers)
    }
  }

  if (singles.length > 0) {
    result.push({
      name: '',
      labeled: false,
      containers: singles,
    })
  }

  return result
})
</script>

<template>
  <div
    class="guest-node guest-card"
    :class="[
      `state-${guest.state}`,
      { 'is-empty': isEmpty },
    ]"
  >
    <!-- Guest header -->
    <component
      :is="guestUrl ? 'a' : 'div'"
      :href="guestUrl || undefined"
      :target="guestUrl ? '_blank' : undefined"
      :rel="guestUrl ? 'noopener noreferrer' : undefined"
      class="guest-header"
      :class="{ 'is-clickable': !!guestUrl }"
    >
      <span
        class="kind-badge"
        :class="{ 'is-inactive': guest.state === 'stopped' || guest.state === 'unknown' }"
      >
        <OsIcon
          :os="guestOs"
          :size="16"
          :dim="guest.state === 'stopped' || guest.state === 'unknown'"
        />
        <span class="kind-text">{{ displayKind }}</span>
      </span>

      <span class="guest-name">{{ guest.name }}</span>
      <span class="spacer"></span>

      <span v-if="guest.ip" class="guest-ip">
        {{ guest.ip }}<span v-if="guestPort" class="guest-port">{{ guestPort }}</span>
      </span>

      <span v-if="specs" class="guest-specs">{{ specs }}</span>

      <StateBadge :state="guest.state" variant="guest" />

      <span v-if="guestUrl" class="guest-arrow">↗</span>
    </component>

    <!-- Stacks and Containers -->
    <div v-if="!isEmpty" class="guest-stacks">
      <div
        v-for="(stack, sIdx) in displayStacks"
        :key="sIdx"
        class="stack-box"
        :class="{ 'is-labeled': stack.labeled }"
      >
        <div v-if="stack.labeled" class="stack-label">
          {{ stack.name }}
        </div>
        <div class="containers-grid">
          <ContainerItem
            v-for="container in stack.containers"
            :key="container.id"
            :container="container"
          />
        </div>
      </div>
    </div>

    <div v-else class="empty-notice">
      No containers.
    </div>
  </div>
</template>

<style scoped>
.guest-card {
  min-width: 0;
  box-sizing: border-box;
  background: oklch(0.215 0.01 250);
  border: 1px solid oklch(0.28 0.01 250);
  border-radius: 6px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.guest-card.state-down {
  border: 1.5px solid oklch(0.62 0.22 27);
  background: oklch(0.22 0.04 27);
}

.guest-card.state-stopped,
.guest-card.state-unknown {
  border: 1px dashed oklch(0.34 0.01 250);
  background: transparent;
}

.guest-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 4px;
  text-decoration: none;
  color: oklch(0.93 0.006 250);
  background: transparent;
  transition: background 0.12s ease;
  user-select: none;
}

.guest-header.is-clickable {
  cursor: pointer;
}
.guest-header.is-clickable:hover {
  background: oklch(0.245 0.01 250);
}

.state-down .guest-header {
  background: oklch(0.62 0.22 27);
  color: #ffffff;
}
.state-down .guest-header.is-clickable:hover {
  background: oklch(0.68 0.22 27);
}

.kind-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px 2px 2px;
  border-radius: 4px;
  border: 1px solid oklch(0.42 0.06 155);
  background: oklch(0.24 0.03 155);
}
.kind-badge.is-inactive {
  border-color: oklch(0.32 0.01 250);
  background: transparent;
}

.kind-text {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: oklch(0.78 0.14 155);
}
.kind-badge.is-inactive .kind-text {
  color: oklch(0.55 0.01 250);
}

.guest-name {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 20px;
  font-weight: 500;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: oklch(0.93 0.006 250);
}

.state-down .guest-name {
  color: #ffffff;
}

.spacer {
  flex: 1;
}

.guest-ip {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  color: oklch(0.62 0.012 250);
  white-space: nowrap;
}
.guest-port {
  color: oklch(0.58 0.012 250);
}
.state-down .guest-ip,
.state-down .guest-port {
  color: rgba(255, 255, 255, 0.85);
}

.guest-specs {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  color: oklch(0.58 0.012 250);
  white-space: nowrap;
}
.state-down .guest-specs {
  color: rgba(255, 255, 255, 0.8);
}

.guest-arrow {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 14px;
  color: oklch(0.6 0.012 250);
  flex: none;
}
.state-down .guest-arrow {
  color: #ffffff;
}

.guest-stacks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 2px 2px;
}

.stack-box {
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 2px;
  display: flex;
  flex-direction: column;
}
.stack-box.is-labeled {
  border-color: oklch(0.33 0.012 250);
}

.stack-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: oklch(0.55 0.012 250);
  padding: 2px 8px 2px;
}

.containers-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
}

@media (max-width: 600px) {
  .containers-grid {
    grid-template-columns: 1fr;
  }
}

.empty-notice {
  padding: 4px 8px 6px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: oklch(0.48 0.01 250);
}
</style>
