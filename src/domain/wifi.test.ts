import { describe, expect, it } from 'vitest'
import { wifiPayload } from '../__fixtures__/wifi'
import { buildWifiGrid, clientTooltip, orderAccessPoints } from './wifi'

describe('buildWifiGrid', () => {
  it('orders the columns like the access point cards on the diagram, then by name', () => {
    const x: Record<string, number> = { '2': 100, '14': 400 }
    expect(orderAccessPoints(wifiPayload.aps, (id) => x[id]).map((a) => a.name)).toEqual(['ap-east', 'ap-west', 'ap-loft'])
    // Without positions: by name.
    expect(orderAccessPoints(wifiPayload.aps, () => undefined).map((a) => a.name)).toEqual(['ap-east', 'ap-loft', 'ap-west'])
  })

  it('makes one row per network and one cell per access point', () => {
    const grid = buildWifiGrid(wifiPayload, (id) => ({ '2': 100, '14': 400 })[id])
    expect(grid.rows.map((r) => `${r.network.ssid} ${r.network.band}`)).toEqual(['Gadgets 2.4', 'Home 5', 'Visitors 2.4'])
    const [gadgets, home, visitors] = grid.rows
    // Columns: ap-east, ap-west, ap-loft.
    expect(gadgets.cells.map((c) => c.kind)).toEqual(['radio', 'radio', 'disabled'])
    expect(home.cells.map((c) => c.kind)).toEqual(['none', 'radio', 'none'])
    expect(visitors.cells.map((c) => c.kind)).toEqual(['radio', 'none', 'none'])
    const west = gadgets.cells[1]
    expect(west.kind === 'radio' && west.radio.channel).toBe(2412)
    expect(west.kind === 'radio' && west.clients.map((c) => c.name)).toEqual(['bulb-hall', 'plug-kitchen'])
    const homeWest = home.cells[1]
    expect(homeWest.kind === 'radio' && homeWest.clients).toEqual([]) // "no clients"
    const down = visitors.cells[0]
    expect(down.kind === 'radio' && down.radio.state).toBe('down')
  })

  it('has no rows or columns for an empty snapshot', () => {
    expect(buildWifiGrid({ networks: [], aps: [], radios: [], clients: [] })).toEqual({ columns: [], rows: [] })
  })

  it('describes a client in its tooltip', () => {
    expect(clientTooltip(wifiPayload.clients[0])).toBe('02:BB:00:00:00:01 · 192.0.2.31 · -58 dBm · up 2d3h')
    expect(clientTooltip(wifiPayload.clients[1])).toBe('02:BB:00:00:00:02')
  })
})
