import type { RawTopology, RawTopologyPort } from '../types/topology'

/**
 * Synthetic cabling for the devices of `netbox.json`: router 1 -> switch 2 over a 10G trunk,
 * the switch -> four servers, the router -> one server at 100M. Invented names and VLANs.
 */
const port = (id: string, deviceId: string, name: string, order: number, extra: Partial<RawTopologyPort> = {}): RawTopologyPort => ({
  id,
  deviceId,
  name,
  order,
  type: '1000base-t',
  speedKbps: null,
  mode: null,
  untagged: null,
  tagged: [],
  mgmtOnly: false,
  ...extra,
})

export const topologyPayload: RawTopology = {
  vlans: [
    { vid: 20, name: 'servers' },
    { vid: 30, name: 'printers' },
  ],
  ports: [
    port('101', '1', 'sfp1', 0, { type: '10gbase-x-sfpp', mode: 'tagged', untagged: 1, tagged: [20, 30] }),
    port('102', '1', 'ether3', 3, { mode: 'access', untagged: 30 }),
    port('201', '2', 'sfp1', 0, { type: '10gbase-x-sfpp', mode: 'tagged', tagged: [20, 30] }),
    port('202', '2', 'port2', 2, { mode: 'access', untagged: 20 }),
    port('203', '2', 'port3', 3, { type: '2.5gbase-t', mode: 'access', untagged: 20 }),
    port('204', '2', 'port4', 4),
    port('205', '2', 'port5', 5, { mode: 'access', untagged: 20 }),
    port('206', '2', 'port6', 6),
    port('1101', '11', 'eth0', 0),
    port('1201', '12', 'eth0', 0, { type: '2.5gbase-t' }),
    port('1301', '13', 'eno1', 0),
    port('1001', '10', 'lan1', 0),
    port('1002', '10', 'lan2', 1),
    port('1401', '14', 'eth0', 0, { type: '100base-tx' }),
  ],
  cables: [
    { id: '1', type: 'dac-passive', a: '101', b: '201' },
    { id: '2', type: 'cat6', a: '1101', b: '202' },
    { id: '3', type: 'cat6', a: '203', b: '1201' },
    { id: '4', type: 'cat6', a: '204', b: '1301' },
    { id: '5', type: 'cat6', a: '205', b: '1001' },
    { id: '6', type: 'cat6', a: '206', b: '1002' },
    { id: '7', type: 'cat5e', a: '102', b: '1401' },
  ],
}
