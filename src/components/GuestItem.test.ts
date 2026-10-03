import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Container, Guest } from '../domain/model'
import GuestItem from './GuestItem.vue'

function makeContainer(id: string, name: string, stack: string | null = null): Container {
  return {
    id,
    name,
    state: 'up',
    services: [],
    image: null,
    stack,
    tags: [],
  }
}

function makeGuestWithItems(opts: {
  id?: string
  name?: string
  multiStacks?: { name: string; containers: Container[] }[]
  singleStacks?: { name: string; container: Container }[]
  standalone?: Container[]
}): Guest {
  const stacks = [
    ...(opts.multiStacks ?? []).map((s) => ({
      name: s.name,
      state: 'up' as const,
      containers: s.containers,
    })),
    ...(opts.singleStacks ?? []).map((s) => ({
      name: s.name,
      state: 'up' as const,
      containers: [s.container],
    })),
  ]

  return {
    id: opts.id ?? 'guest-1',
    name: opts.name ?? 'test-guest',
    kind: 'KVM',
    state: 'up',
    vcpus: 2,
    memoryMb: 2048,
    disk: null,
    ip: '198.51.100.20',
    platform: null,
    cluster: null,
    tags: [],
    services: [],
    stacks,
    standalone: opts.standalone ?? [],
  }
}

describe('GuestItem: stack framing and grouping', () => {
  it('renders multi-container stacks as full-width labelled frames', () => {
    const guest = makeGuestWithItems({
      multiStacks: [
        {
          name: 'workflow-engine',
          containers: [makeContainer('c1', 'workflow-core', 'workflow-engine'), makeContainer('c2', 'workflow-worker', 'workflow-engine')],
        },
      ],
    })

    const wrapper = mount(GuestItem, { props: { guest } })
    const multiStackBoxes = wrapper.findAll('.guest-stacks > .stack-box.is-labeled')
    expect(multiStackBoxes).toHaveLength(1)

    const label = multiStackBoxes[0].find('.stack-label')
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe('workflow-engine')

    const containers = multiStackBoxes[0].findAll('.container-node')
    expect(containers).toHaveLength(2)
  })

  it('renders 1-container stacks in labelled frames inside the shared singles grid', () => {
    const guest = makeGuestWithItems({
      singleStacks: [
        { name: 'tunnel', container: makeContainer('c1', 'tunnel-agent', 'tunnel') },
        { name: 'telemetry-view', container: makeContainer('c2', 'telemetry-view', 'telemetry-view') },
      ],
      standalone: [makeContainer('c3', 'control-panel', null)],
    })

    const wrapper = mount(GuestItem, { props: { guest } })
    const singlesGrid = wrapper.find('.singles-grid')
    expect(singlesGrid.exists()).toBe(true)

    // The shared grid has 3 items: 2 single stack boxes + 1 bare container
    const singleStackBoxes = singlesGrid.findAll('.stack-box.is-labeled.is-single')
    expect(singleStackBoxes).toHaveLength(2)

    const labels = singleStackBoxes.map((box) => box.find('.stack-label').text())
    expect(labels).toEqual(['tunnel', 'telemetry-view'])

    // Bare container is in the singles grid but NOT inside any stack box
    const bareContainer = singlesGrid.findAll('.container-node').find((c) =>
      c.find('.container-name').text() === 'control-panel',
    )
    expect(bareContainer?.exists()).toBe(true)
    expect(bareContainer?.element.parentElement).toBe(singlesGrid.element)

    // And control-panel has no stack label
    expect(bareContainer?.find('.stack-label').exists()).toBe(false)
  })

  it('leaves standalone containers bare with no stack frame or label', () => {
    const guest = makeGuestWithItems({
      standalone: [
        makeContainer('std1', 'cluster-agent-auth', null),
      ],
    })

    const wrapper = mount(GuestItem, { props: { guest } })
    expect(wrapper.findAll('.stack-box.is-labeled')).toHaveLength(0)
    expect(wrapper.findAll('.stack-label')).toHaveLength(0)

    const container = wrapper.find('.container-node')
    expect(container.exists()).toBe(true)
    expect(container.text()).toContain('cluster-agent-auth')
  })
})
