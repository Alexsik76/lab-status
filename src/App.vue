<script setup lang="ts">
import { onMounted, ref } from 'vue'

interface Counts {
  devices: number
  virtualMachines: number
  services: number
}

interface NamedList {
  name: string
}

interface GraphQLResponse {
  data?: {
    device_list: NamedList[]
    virtual_machine_list: NamedList[]
    service_list: NamedList[]
  }
  errors?: { message: string }[]
}

const QUERY =
  '{ device_list { name } virtual_machine_list { name } service_list { name } }'

const loading = ref(true)
const error = ref<string | null>(null)
const counts = ref<Counts | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch('/netbox/graphql/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY }),
    })
    if (!res.ok) {
      throw new Error(`NetBox request failed: HTTP ${res.status} ${res.statusText}`)
    }
    const body = (await res.json()) as GraphQLResponse
    if (body.errors?.length) {
      throw new Error(body.errors.map((e) => e.message).join('; '))
    }
    if (!body.data) {
      throw new Error('Response contains no data')
    }
    counts.value = {
      devices: body.data.device_list.length,
      virtualMachines: body.data.virtual_machine_list.length,
      services: body.data.service_list.length,
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <main>
    <h1>Lab Status</h1>
    <p v-if="loading">Loading…</p>
    <p v-else-if="error" class="error" role="alert">Could not load data: {{ error }}</p>
    <ul v-else-if="counts">
      <li>Devices: {{ counts.devices }}</li>
      <li>Virtual machines: {{ counts.virtualMachines }}</li>
      <li>Services: {{ counts.services }}</li>
    </ul>
  </main>
</template>

<style>
body {
  font-family: system-ui, sans-serif;
  margin: 2rem;
}
.error {
  color: #b00020;
}
</style>
