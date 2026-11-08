import { describe, expect, it } from 'vitest'
import type { ArpRow } from '../types/arp'
import {
  applyArpEvent,
  compareAddresses,
  countViews,
  indexArpPresence,
  matchesView,
  samePresence,
} from './arp'

const row = (id: string, overrides: Partial<ArpRow> = {}): ArpRow => ({
  id,
  address: `192.0.2.${id.replace('*', '')}`,
  mac: `02:00:00:00:00:${id.replace('*', '').padStart(2, '0')}`,
  interface: 'vlan10',
  status: 'reachable',
  presence: 'active',
  dhcp: false,
  dynamic: true,
  disabled: false,
  macSource: 'arp',
  lease: null,
  netbox: null,
  ...overrides,
})

const nb = (kind: 'device' | 'vm', id: string) => ({
  kind,
  id,
  name: `${kind}-${id}`,
  role: null,
  status: 'active',
  description: '',
  interface: 'eth0',
  url: null,
})

describe('applyArpEvent', () => {
  it('replaces, upserts and removes rows', () => {
    let rows = applyArpEvent(new Map(), { type: 'snapshot', rows: [row('*1'), row('*2')] })
    expect([...rows.keys()]).toEqual(['*1', '*2'])
    rows = applyArpEvent(rows, { type: 'upsert', row: row('*1', { status: 'stale' }) })
    expect(rows.get('*1')?.status).toBe('stale')
    rows = applyArpEvent(rows, { type: 'remove', id: '*2' })
    expect([...rows.keys()]).toEqual(['*1'])
  })

  it('keeps the same map for unknown removals and status events', () => {
    const rows = applyArpEvent(new Map(), { type: 'snapshot', rows: [row('*1')] })
    expect(applyArpEvent(rows, { type: 'remove', id: '*9' })).toBe(rows)
    expect(applyArpEvent(rows, { type: 'status', state: 'live', error: null })).toBe(rows)
  })
})

describe('indexArpPresence', () => {
  it('marks an object up when any of its MACs is active', () => {
    const index = indexArpPresence([
      row('*1', { netbox: nb('device', '7'), presence: 'disconnected', status: 'failed' }),
      row('*2', { netbox: nb('device', '7') }),
      row('*3', { netbox: nb('vm', '4'), presence: 'disconnected', status: 'incomplete' }),
      row('*4'),
    ])
    expect(Object.fromEntries(index)).toEqual({ 'device:7': 'up', 'vm:4': 'down' })
  })

  it('ignores rows whose presence is unknown', () => {
    expect(indexArpPresence([row('*1', { netbox: nb('vm', '1'), presence: 'unknown', status: '' })]).size).toBe(0)
  })

  it('compares indexes by content', () => {
    const a = indexArpPresence([row('*1', { netbox: nb('vm', '1') })])
    const b = indexArpPresence([row('*1', { netbox: nb('vm', '1'), status: 'stale' })])
    expect(samePresence(a, b)).toBe(true)
    expect(samePresence(a, new Map())).toBe(false)
  })
})

describe('views', () => {
  const rows = [
    row('*1', { netbox: nb('device', '1') }),
    row('*2', { presence: 'disconnected', status: 'failed' }),
    row('*3', { netbox: nb('vm', '2'), presence: 'disconnected', status: 'failed' }),
  ]

  it('counts the three views and the total', () => {
    expect(countViews(rows)).toEqual({ all: 3, unknown: 1, active: 1, disconnected: 2 })
  })

  it('filters rows by view', () => {
    expect(rows.filter((r) => matchesView(r, 'unknown')).map((r) => r.id)).toEqual(['*2'])
    expect(rows.filter((r) => matchesView(r, 'disconnected')).map((r) => r.id)).toEqual(['*2', '*3'])
  })
})

describe('compareAddresses', () => {
  it('orders IPv4 numerically', () => {
    expect(['192.0.2.10', '192.0.2.9', '198.51.100.1'].sort(compareAddresses)).toEqual([
      '192.0.2.9',
      '192.0.2.10',
      '198.51.100.1',
    ])
  })
})
