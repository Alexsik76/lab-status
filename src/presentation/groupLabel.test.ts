import { describe, expect, it } from 'vitest'
import type { TopologyGroup } from '../domain/topology'
import { groupCountText, groupLabel, isRecorder } from './groupLabel'

type Member = { roleSlug: string | null; model: string | null }
const cam: Member = { roleSlug: 'camera', model: 'IP Camera' }
const nvr: Member = { roleSlug: 'camera', model: 'NVR' }
const ap: Member = { roleSlug: 'access-point', model: 'AP-1' }

/** A camera group of the given members, ids `m0`, `m1`… */
function cameras(members: Member[], vlan: number | null = 40) {
  const devices = new Map(members.map((m, i) => [`m${i}`, m]))
  const group: TopologyGroup = {
    id: 'cameras:3',
    definitionId: 'cameras',
    label: 'Cameras',
    roleSlug: 'camera',
    upstreamId: '3',
    memberIds: [...devices.keys()],
    vlan,
  }
  return { group, devices }
}
const vlans = [{ vid: 40, name: 'lenses' }]

describe('isRecorder', () => {
  it('tells a recorder by its model, whatever the case or suffix', () => {
    expect(isRecorder(nvr)).toBe(true)
    expect(isRecorder({ roleSlug: 'camera', model: 'nvr-4108' })).toBe(true)
    expect(isRecorder(cam)).toBe(false)
    expect(isRecorder({ roleSlug: 'camera', model: 'Envoy' })).toBe(false)
    expect(isRecorder({ roleSlug: 'camera', model: null })).toBe(false)
  })
})

describe('groupCountText', () => {
  it('spells out cameras and recorders', () => {
    const { group, devices } = cameras([cam, cam, cam, nvr])
    expect(groupCountText(group, devices)).toBe('3 cameras + 1 NVR')
  })

  it('leaves the recorder part out without one, and uses the plural for several', () => {
    expect(groupCountText(cameras([cam, cam]).group, cameras([cam, cam]).devices)).toBe('2 cameras')
    const two = cameras([cam, nvr, nvr])
    expect(groupCountText(two.group, two.devices)).toBe('1 camera + 2 NVRs')
  })

  it('gives only the total when a member is neither a camera nor a recorder', () => {
    const { group, devices } = cameras([cam, cam, nvr, ap])
    expect(groupCountText(group, devices)).toBe('4 devices')
  })

  it('gives only the total when a member has no device record', () => {
    const { group, devices } = cameras([cam, nvr])
    expect(groupCountText({ ...group, memberIds: [...group.memberIds, 'gone'] }, devices)).toBe('3 devices')
  })

  it('counts the members of any other group', () => {
    const { group, devices } = cameras([cam, ap])
    expect(groupCountText({ ...group, id: 'proxmox', definitionId: 'proxmox', label: 'Proxmox nodes' }, devices)).toBe('2')
  })
})

describe('groupLabel', () => {
  it('puts the VLAN before the composition of the camera group', () => {
    const { group, devices } = cameras([cam, cam, nvr])
    expect(groupLabel(group, devices, vlans)).toBe('VLAN 40 lenses · 2 cameras + 1 NVR')
  })

  it('shows the composition alone without a common VLAN, and the VLAN number without a name', () => {
    const { group, devices } = cameras([cam, cam, nvr], null)
    expect(groupLabel(group, devices, vlans)).toBe('2 cameras + 1 NVR')
    expect(groupLabel({ ...group, vlan: 70 }, devices, vlans)).toBe('VLAN 70 · 2 cameras + 1 NVR')
  })

  it('keeps name, count and VLAN for other groups', () => {
    const { group, devices } = cameras([cam, cam])
    const hv = { ...group, id: 'proxmox', definitionId: 'proxmox', label: 'Proxmox nodes' }
    expect(groupLabel(hv, devices, vlans)).toBe('Proxmox nodes · 2 · VLAN 40 lenses')
    expect(groupLabel({ ...hv, vlan: null }, devices, vlans)).toBe('Proxmox nodes · 2')
  })
})
