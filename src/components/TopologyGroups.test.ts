import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { device } from '../__fixtures__/topologyGroups'
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
const devices = [device('31', 'cam-north', 'camera'), device('32', 'cam-south', 'camera'), { ...device('33', 'recorder', 'camera'), model: 'NVR' }]

describe('TopologyGroups', () => {
  it('draws the frame at the group rectangle', () => {
    const frame = mount(TopologyGroups, { props: { groups: [placed(40)], vlans, devices, part: 'frame' } }).find('.topo-group')
    expect(frame.attributes('style')).toContain('left: 40px')
    expect(frame.attributes('style')).toContain('top: 300px')
    expect(frame.attributes('style')).toContain('width: 600px')
    expect(frame.attributes('style')).toContain('height: 120px')
    expect(frame.text()).toBe('')
  })

  it('puts the label at the bottom-left corner, on the bottom border, with VLAN and composition', () => {
    const label = mount(TopologyGroups, { props: { groups: [placed(40)], vlans, devices, part: 'label' } }).find('.group-label')
    expect(label.text()).toBe('VLAN 40 cams · 2 cameras + 1 NVR')
    // Left inset 10 px; top at the bottom border (y + height); CSS centres it on that line.
    expect(label.attributes('style')).toContain('left: 50px')
    expect(label.attributes('style')).toContain('top: 420px')
    expect(label.classes()).toContain('has-vlan')
    expect(label.attributes('style')).toContain('--group-color: var(--color-vlan-40)')
  })

  it('keeps a neutral label without a common VLAN', () => {
    const label = mount(TopologyGroups, { props: { groups: [placed(null)], vlans, devices, part: 'label' } }).find('.group-label')
    expect(label.text()).toBe('2 cameras + 1 NVR')
    expect(label.classes()).not.toContain('has-vlan')
  })
})
