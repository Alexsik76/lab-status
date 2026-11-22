import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { TopologyGroup } from '../domain/topology'
import type { PlacedGroup } from '../presentation/topologyLayout'
import TopologyGroups from './TopologyGroups.vue'

const group = (vlan: number | null): TopologyGroup => ({
  id: 'cameras:3',
  definitionId: 'cameras',
  label: 'Cameras',
  roleSlug: 'camera',
  upstreamId: '3',
  memberIds: ['31', '32', '33'],
  vlan,
})
const placed = (vlan: number | null): PlacedGroup => ({ group: group(vlan), x: 40, y: 300, width: 600, height: 120 })
const vlans = [{ vid: 40, name: 'cams' }]

describe('TopologyGroups', () => {
  it('draws the frame at the group rectangle', () => {
    const frame = mount(TopologyGroups, { props: { groups: [placed(40)], vlans, part: 'frame' } }).find('.topo-group')
    expect(frame.attributes('style')).toContain('left: 40px')
    expect(frame.attributes('style')).toContain('top: 300px')
    expect(frame.attributes('style')).toContain('width: 600px')
    expect(frame.attributes('style')).toContain('height: 120px')
    expect(frame.text()).toBe('')
  })

  it('puts the label at the bottom-left corner, on the bottom border, with name, count and VLAN', () => {
    const label = mount(TopologyGroups, { props: { groups: [placed(40)], vlans, part: 'label' } }).find('.group-label')
    expect(label.text()).toBe('Cameras · 3 · VLAN 40 cams')
    // Left inset 10 px; top at the bottom border (y + height); CSS centres it on that line.
    expect(label.attributes('style')).toContain('left: 50px')
    expect(label.attributes('style')).toContain('top: 420px')
    expect(label.classes()).toContain('has-vlan')
    expect(label.attributes('style')).toContain('--group-color: var(--color-vlan-40)')
  })

  it('keeps a neutral label without a common VLAN', () => {
    const label = mount(TopologyGroups, { props: { groups: [placed(null)], vlans, part: 'label' } }).find('.group-label')
    expect(label.text()).toBe('Cameras · 3')
    expect(label.classes()).not.toContain('has-vlan')
  })
})
