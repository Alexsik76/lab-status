import type { ZigbeeData } from '../types/zigbee'

/** Synthetic Zigbee snapshot (invented names, areas and models); coordinator = device 13. */
export const zigbeePayload: ZigbeeData = {
  coordinator: { deviceId: '13', version: '2.1.0' },
  devices: [
    { id: 'z3', name: 'Porch motion', manufacturer: 'Acme', model: 'PIR-1', area: 'Porch', available: true },
    { id: 'z1', name: 'Attic plug', manufacturer: 'Acme', model: 'PLUG-2', area: null, available: false },
    { id: 'z2', name: 'Hall button', manufacturer: 'Acme', model: 'BTN-3', area: 'Hall', available: true },
  ],
}
