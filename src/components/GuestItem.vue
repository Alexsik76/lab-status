<script setup lang="ts">
import { computed } from 'vue'
import type { Container, Guest, Stack, TagItem } from '../domain/model'
import { formatMemory } from '../format'
import { getNodePrimaryUrlAndPort } from '../presentation/url'
import ContainerItem from './ContainerItem.vue'
import LinkOrPlain from './LinkOrPlain.vue'
import OsIcon from './OsIcon.vue'
import StateBadge from './StateBadge.vue'
import Tag from './Tag.vue'

const props = defineProps<{ guest: Guest }>()

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

const guestTags = computed<TagItem[]>(() => props.guest.tags ?? [])

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
    <LinkOrPlain
      :href="guestUrl"
      class="guest-header"
      :class="{ 'is-clickable': !!guestUrl }"
    >
      <span
        class="kind-badge"
        :class="{ 'is-inactive': guest.state === 'stopped' || guest.state === 'unknown' }"
      >
        <OsIcon
          :platform="guest.platform"
          :size="16"
          :dim="guest.state === 'stopped' || guest.state === 'unknown'"
        />
        <span class="kind-text">{{ displayKind }}</span>
      </span>

      <span class="guest-name">{{ guest.name }}</span>

      <!-- GitHub-style tags with NetBox colors -->
      <span v-if="guestTags.length" class="guest-tags">
        <Tag v-for="tag in guestTags" :key="tag.name" :tag="tag" size="md" />
      </span>

      <span class="spacer"></span>

      <span v-if="guest.ip" class="guest-ip">
        {{ guest.ip }}<span v-if="guestPort" class="guest-port">{{ guestPort }}</span>
      </span>

      <span v-if="specs" class="guest-specs">{{ specs }}</span>

      <StateBadge :state="guest.state" variant="guest" />

      <span v-if="guestUrl" class="guest-arrow">↗</span>
    </LinkOrPlain>

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
  background: var(--color-bg-guest);
  border: 1px solid var(--color-border-guest);
  border-radius: var(--radius-md);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.guest-card.state-down {
  border: 1.5px solid var(--color-state-down);
  background: var(--color-bg-guest-down);
}

.guest-card.state-stopped,
.guest-card.state-unknown {
  border: 1px dashed var(--color-border-dashed);
  background: transparent;
}

.guest-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: var(--color-text-primary);
  background: transparent;
  transition: background 0.12s ease;
  user-select: none;
}

.guest-header.is-clickable {
  cursor: pointer;
}
.guest-header.is-clickable:hover {
  background: var(--color-bg-hover);
}

.state-down .guest-header {
  background: var(--color-state-down);
  color: var(--color-text-white);
}
.state-down .guest-header.is-clickable:hover {
  background: var(--color-state-down-hover);
}

.kind-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px 2px 2px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-kind-active-border);
  background: var(--color-kind-active-bg);
}
.kind-badge.is-inactive {
  border-color: var(--color-kind-inactive-border);
  background: transparent;
}

.state-down .kind-badge {
  border-color: var(--color-kind-down-border);
}

.kind-text {
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--color-kind-active-fg);
}
.kind-badge.is-inactive .kind-text {
  color: var(--color-kind-inactive-fg);
}
.state-down .kind-badge .kind-text {
  color: var(--color-text-white);
}

.guest-name {
  font-family: var(--font-sans);
  font-size: 20px;
  font-weight: 500;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-primary);
}

.guest-tags {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-left: 2px;
}

.state-down .guest-name {
  color: var(--color-text-white);
}
.state-stopped .guest-name {
  color: var(--color-text-stopped);
}
.state-unknown .guest-name {
  color: var(--color-text-unknown);
}

.spacer {
  flex: 1;
}

.guest-ip {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text-ip);
  white-space: nowrap;
}
.guest-port {
  color: var(--color-text-port);
}
.state-down .guest-ip,
.state-down .guest-port {
  color: var(--color-text-down-muted);
}

.guest-specs {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-port);
  white-space: nowrap;
}
.state-down .guest-specs {
  color: var(--color-text-down-subtle);
}

.guest-arrow {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--color-text-muted);
  flex: none;
}
.state-down .guest-arrow {
  color: var(--color-text-white);
}

.guest-stacks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 2px 2px;
}

.stack-box {
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 2px;
  display: flex;
  flex-direction: column;
}
.stack-box.is-labeled {
  border-color: var(--color-border-stack);
}

.stack-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-stack-label);
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
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-dim);
}
</style>
