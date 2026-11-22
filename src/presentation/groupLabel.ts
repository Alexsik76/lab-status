import type { DeviceRecord } from '../domain/model'
import type { TopologyGroup } from '../domain/topology'
import type { RawTopologyVlan } from '../types/topology'

type Member = Pick<DeviceRecord, 'roleSlug' | 'model'>

/**
 * A network video recorder. NetBox gives it the camera role (it is cabled and grouped with the
 * cameras); only its device type's model names it, e.g. `NVR` or `NVR-4108`.
 */
export const isRecorder = (d: Member): boolean => /\bnvr\b/i.test(d.model ?? '')

const isCamera = (d: Member): boolean => d.roleSlug === 'camera' && !isRecorder(d)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * What a group holds. The camera group spells out its composition, `7 cameras + 1 NVR`
 * (`3 cameras` without a recorder); when some member is neither a camera nor a recorder, or is
 * not among the device records, only the total: `9 devices`. Other groups: the member count.
 */
export function groupCountText(group: TopologyGroup, devices: ReadonlyMap<string, Member>): string {
  const total = group.memberIds.length
  if (group.definitionId !== 'cameras') return String(total)
  const members = group.memberIds.map((id) => devices.get(id))
  const cameras = members.filter((d) => d && isCamera(d)).length
  const recorders = members.filter((d) => d && isRecorder(d)).length
  if (cameras + recorders !== total) return plural(total, 'device', 'devices')
  const parts = [plural(cameras, 'camera', 'cameras')]
  if (recorders > 0) parts.push(plural(recorders, 'NVR', 'NVRs'))
  return parts.join(' + ')
}

/**
 * The label of a group frame. The camera group: VLAN first, then the composition,
 * `VLAN 40 cams · 7 cameras + 1 NVR`. Other groups: `Proxmox nodes · 2 · VLAN 60 lab`.
 * The VLAN part is left out when the members do not share one.
 */
export function groupLabel(group: TopologyGroup, devices: ReadonlyMap<string, Member>, vlans: readonly RawTopologyVlan[]): string {
  const vlan = group.vlan
  const name = vlan === null ? undefined : vlans.find((v) => v.vid === vlan)?.name
  const vlanText = vlan === null ? null : `VLAN ${vlan}${name ? ` ${name}` : ''}`
  const count = groupCountText(group, devices)
  const parts = group.definitionId === 'cameras' ? [vlanText, count] : [group.label, count, vlanText]
  return parts.filter((p): p is string => p !== null).join(' · ')
}
