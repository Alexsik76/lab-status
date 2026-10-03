<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import type { State } from '../domain/model'
import type { StatusPhase } from '../composables/useStatuses'
import { statusPhaseKey } from '../injection'

const props = withDefaults(
  defineProps<{
    state: State
    variant?: 'machine' | 'guest' | 'container' | 'default'
    blinking?: boolean
  }>(),
  {
    variant: 'default',
    blinking: false,
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
    :class="[
      `variant-${variant}`,
      `state-${pending ? 'pending' : state}`,
      { 'is-blinking': blinking },
    ]"
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
  font-family: var(--font-mono);
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
  border-radius: var(--radius-sm);
}
.variant-machine.state-up {
  color: var(--color-state-up);
  background: transparent;
}
.variant-machine.state-down {
  color: var(--color-text-white);
  background: var(--color-state-down);
}
.variant-machine.state-pending,
.variant-machine.state-unknown,
.variant-machine.state-stopped {
  color: var(--color-text-unknown);
  background: transparent;
}

/* Dot indicator */
.status-dot {
  display: inline-block;
  border-radius: var(--radius-pill);
  box-sizing: border-box;
  flex: none;
}

.variant-machine .status-dot {
  width: 7px;
  height: 7px;
}
.variant-machine.state-up .status-dot {
  background: var(--color-state-up);
}
.variant-machine.state-down .status-dot {
  background: var(--color-text-white);
}
.variant-machine.state-pending .status-dot,
.variant-machine.state-unknown .status-dot {
  background: transparent;
  border: 1.5px dashed var(--color-state-unknown-dot);
}

/* Guest variant: 9px dot */
.variant-guest .status-dot {
  width: 9px;
  height: 9px;
}
.variant-guest.state-up .status-dot {
  background: var(--color-state-up);
  border: 1.5px solid var(--color-state-up);
}
.variant-guest.state-down .status-dot {
  background: var(--color-text-white);
  border: 1.5px solid var(--color-text-white);
}
.variant-guest.state-stopped .status-dot {
  background: transparent;
  border: 1.5px solid var(--color-state-stopped-dot);
}
.variant-guest.state-pending .status-dot,
.variant-guest.state-unknown .status-dot {
  background: transparent;
  border: 1.5px dashed var(--color-state-unknown-dot);
}

/* Container variant: 7px dot */
.variant-container .status-dot {
  width: 7px;
  height: 7px;
}
.variant-container.state-up .status-dot {
  background: var(--color-state-up);
  border: 1.5px solid var(--color-state-up);
}
.variant-container.state-down .status-dot {
  background: var(--color-text-white);
  border: 1.5px solid var(--color-text-white);
}
.variant-container.state-stopped .status-dot {
  background: transparent;
  border: 1.5px solid var(--color-state-stopped-dot);
}
.variant-container.state-pending .status-dot,
.variant-container.state-unknown .status-dot {
  background: transparent;
  border: 1.5px dashed var(--color-state-unknown-dot);
}

/* Default fallback */
.variant-default {
  padding: 0 0.4em;
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
}
.variant-default.state-up {
  color: var(--color-state-up);
}
.variant-default.state-down {
  color: var(--color-state-down);
}
.variant-default.state-pending,
.variant-default.state-unknown,
.variant-default.state-stopped {
  color: var(--color-state-unknown-dot);
}

/* Status tags */
.status-tag {
  font-size: 10px;
  letter-spacing: 0.1em;
}
.variant-guest.state-stopped .status-tag {
  color: var(--color-text-stopped);
}
.variant-guest.state-down .status-tag,
.variant-container.state-down .status-tag {
  color: var(--color-text-white);
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

/* Blinking dot for down containers */
.is-blinking .status-dot {
  animation: blink-dot 1.2s ease-in-out infinite;
}

@keyframes blink-dot {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.2;
  }
}

@media (prefers-reduced-motion: reduce) {
  .state-pending .status-dot,
  .is-blinking .status-dot {
    animation: none;
  }
}
</style>
