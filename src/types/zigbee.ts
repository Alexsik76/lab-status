/** The `zigbee` stream source (backend/app/zigbee.py): Zigbee2MQTT via Home Assistant. */

export interface ZigbeeDevice {
  id: string
  name: string
  manufacturer: string | null
  model: string | null
  area: string | null
  /**
   * true: at least one of its enabled entities is not `unavailable`; false: none is; null: it has
   * no enabled entity, so its availability is unknown (shown like an available device).
   */
  available: boolean | null
}

export interface ZigbeeData {
  coordinator: { deviceId: string | null; version: string | null }
  devices: ZigbeeDevice[]
}
