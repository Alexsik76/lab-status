<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import type { State } from '../domain/model'
import type { StatusPhase } from '../composables/useStatuses'
import { statusPhaseKey } from '../injection'

const props = withDefaults(
  defineProps<{
    state: State
    variant?: 'machine' | 'guest' | 'container' | 'default'
  }>(),
  {
    variant: 'default',
  },
)

const phase = inject(statusPhaseKey, ref<StatusPhase>('ready'))

const LABELS: Record<State, string> = {
  up: 'up',
  down: 'down',
  stopped: 'stopped',
  unknown: 'unknown',
}

/** `stopped` comes from NetBox; everything else waits for the status service. */
const pending = computed(() => phase.value === 'loading' && props.state === 'unknown')

const machineLabel = computed(() => {
  if (pending.value) return 'checking…'
  if (props.state === 'up') return 'online'
  if (props.state === 'down') return 'unreachable'
  return props.state
})
</script>

<template>
  <span
    class="state"
    :class="[`variant-${variant}`, `state-${pending ? 'pending' : state}`]"
    :data-state="pending ? 'pending' : state"
  >
    <!-- Dot indicator -->
    <span class="status-dot"></span>

    <!-- Machine variant label -->
    <span v-if="variant === 'machine'" class="status-text">
      {{ machineLabel }}
    </span>

    <!-- Guest / Container tag (e.g. STOPPED, DOWN) -->
    <span
      v-else-if="(variant === 'guest' || variant === 'container') && (state === 'stopped' || state === 'down')"
      class="status-tag"
    >
      {{ state }}
    </span>

    <!-- Default variant text -->
    <span v-else-if="variant === 'default'" class="status-text">
      {{ pending ? 'checking…' : LABELS[state] }}
    </span>
  </span>
</template>

<style scoped>
.state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  box-sizing: border-box;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  flex: none;
  line-height: 1;
}

/* Machine variant: pill badge */
.variant-machine {
  padding: 3px 6px;
  border-radius: 4px;
}
.variant-machine.state-up {
  color: oklch(0.78 0.14 155);
  background: transparent;
}
.variant-machine.state-down {
  color: #ffffff;
  background: oklch(0.62 0.22 27);
}
.variant-machine.state-pending,
.variant-machine.state-unknown,
.variant-machine.state-stopped {
  color: oklch(0.66 0.01 250);
  background: transparent;
}

/* Dot indicator */
.status-dot {
  display: inline-block;
  border-radius: 50%;
  box-sizing: border-box;
  flex: none;
}

.variant-machine .status-dot {
  width: 7px;
  height: 7px;
}
.variant-machine.state-up .status-dot {
  background: oklch(0.78 0.14 155);
}
.variant-machine.state-down .status-dot {
  background: #ffffff;
}
.variant-machine.state-pending .status-dot,
.variant-machine.state-unknown .status-dot {
  background: transparent;
  border: 1.5px dashed oklch(0.55 0.01 250);
}

/* Guest variant: 9px dot */
.variant-guest .status-dot {
  width: 9px;
  height: 9px;
}
.variant-guest.state-up .status-dot {
  background: oklch(0.78 0.14 155);
  border: 1.5px solid oklch(0.78 0.14 155);
}
.variant-guest.state-down .status-dot {
  background: #ffffff;
  border: 1.5px solid #ffffff;
}
.variant-guest.state-stopped .status-dot {
  background: transparent;
  border: 1.5px solid oklch(0.55 0.01 250);
}
.variant-guest.state-pending .status-dot,
.variant-guest.state-unknown .status-dot {
  background: transparent;
  border: 1.5px dashed oklch(0.55 0.01 250);
}

/* Container variant: 7px dot */
.variant-container .status-dot {
  width: 7px;
  height: 7px;
}
.variant-container.state-up .status-dot {
  background: oklch(0.78 0.14 155);
  border: 1.5px solid oklch(0.78 0.14 155);
}
.variant-container.state-down .status-dot {
  background: #ffffff;
  border: 1.5px solid #ffffff;
}
.variant-container.state-stopped .status-dot {
  background: transparent;
  border: 1.5px solid oklch(0.55 0.01 250);
}
.variant-container.state-pending .status-dot,
.variant-container.state-unknown .status-dot {
  background: transparent;
  border: 1.5px dashed oklch(0.55 0.01 250);
}

/* Default fallback */
.variant-default {
  padding: 0 0.4em;
  border: 1px solid currentColor;
  border-radius: 0.6em;
}
.variant-default.state-up {
  color: oklch(0.78 0.14 155);
}
.variant-default.state-down {
  color: oklch(0.62 0.22 27);
}
.variant-default.state-pending,
.variant-default.state-unknown,
.variant-default.state-stopped {
  color: oklch(0.55 0.01 250);
}

/* Status tags */
.status-tag {
  font-size: 10px;
  letter-spacing: 0.1em;
}
.variant-guest.state-stopped .status-tag {
  color: oklch(0.52 0.01 250);
}
.variant-guest.state-down .status-tag,
.variant-container.state-down .status-tag {
  color: #ffffff;
}

/* Pending pulse */
.state-pending .status-dot {
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
