import type { WifiData } from '../types/wifi'

/**
 * Synthetic Wi-Fi snapshot (invented SSIDs, names, MACs and addresses). The access point
 * `ap-east` is NetBox device 2 of the topology fixture, `ap-west` device 14; `ap-loft` is not
 * in NetBox.
 */
export const wifiPayload: WifiData = {
  networks: [
    { ssid: 'Gadgets', band: '2.4', vlan: 30 },
    { ssid: 'Home', band: '5', vlan: 20 },
    { ssid: 'Visitors', band: '2.4', vlan: null },
  ],
  aps: [
    { id: '[02:AA:00:00:00:03]', name: 'ap-loft', deviceId: null },
    { id: '[02:AA:00:00:00:01]', name: 'ap-west', deviceId: '14' },
    { id: '[02:AA:00:00:00:02]', name: 'ap-east', deviceId: '2' },
  ],
  radios: [
    { apId: '[02:AA:00:00:00:01]', ssid: 'Gadgets', band: '2.4', channel: 2412, state: 'running' },
    { apId: '[02:AA:00:00:00:01]', ssid: 'Home', band: '5', channel: 5180, state: 'running' },
    { apId: '[02:AA:00:00:00:02]', ssid: 'Gadgets', band: '2.4', channel: 2462, state: 'running' },
    { apId: '[02:AA:00:00:00:02]', ssid: 'Visitors', band: '2.4', channel: 2462, state: 'down' },
    { apId: '[02:AA:00:00:00:03]', ssid: 'Gadgets', band: '2.4', channel: null, state: 'disabled' },
  ],
  clients: [
    { apId: '[02:AA:00:00:00:01]', ssid: 'Gadgets', band: '2.4', mac: '02:BB:00:00:00:01', name: 'plug-kitchen',
      deviceId: null, ip: '192.0.2.31', signal: -58, uptime: '2d3h' },
    { apId: '[02:AA:00:00:00:01]', ssid: 'Gadgets', band: '2.4', mac: '02:BB:00:00:00:02', name: 'bulb-hall',
      deviceId: null, ip: null, signal: null, uptime: null },
    { apId: '[02:AA:00:00:00:02]', ssid: 'Gadgets', band: '2.4', mac: '02:BB:00:00:00:03', name: 'node-alpha',
      deviceId: '11', ip: '192.0.2.11', signal: -49, uptime: '5h' },
  ],
}
