<script setup lang="ts">
import type { Stack } from '../domain/model'
import ContainerItem from './ContainerItem.vue'
import NodeSummary from './NodeSummary.vue'

defineProps<{ stack: Stack }>()
</script>

<template>
  <li class="stack-node">
    <NodeSummary kind="stack" :name="stack.name" :state="stack.state" />
    <ul>
      <ContainerItem v-for="container in stack.containers" :key="container.id" :container="container" />
    </ul>
  </li>
</template>
