<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    href?: string | null
    as?: string
    title?: string
    target?: string
    rel?: string
  }>(),
  {
    href: null,
    as: 'div',
    title: undefined,
    target: '_blank',
    rel: 'noopener noreferrer',
  },
)
</script>

<template>
  <a
    v-if="props.href"
    :href="props.href"
    :target="props.target"
    :rel="props.rel"
    :title="props.title"
  >
    <slot />
  </a>
  <component :is="props.as" v-else :title="props.title">
    <slot />
  </component>
</template>
