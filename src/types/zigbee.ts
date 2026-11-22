/** The `zigbee` stream source (backend/app/zigbee.py): Zigbee2MQTT via Home Assistant. */

export interface ZigbeeDevice {
  id: string
  name: string
  manufacturer: string | null
  model: string | null
  area: string | null
  /** At least one of its entities is not `unavailable`. */
  available: boolean
}

export interface ZigbeeData {
  coordinator: { deviceId: string | null; version: string | null }
  devices: ZigbeeDevice[]
}
