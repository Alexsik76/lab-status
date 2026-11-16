/**
 * Icons come from Dashboard Icons (github.com/homarr-labs/dashboard-icons, Apache-2.0),
 * by the name stored in the NetBox custom field `icon`. Pinned to one commit so an
 * icon never changes under us; bump the commit to pick up new or redrawn icons.
 */
export const DASHBOARD_ICONS_COMMIT = 'd4b500dc40a8e1043b1581cabb7208892cf35472'

const BASE = `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@${DASHBOARD_ICONS_COMMIT}/svg`

/** URL of a Dashboard Icons SVG, or null when the name is missing or not a valid icon name. */
export function iconUrl(name: string | null | undefined): string | null {
  return name && /^[a-z0-9-]+$/.test(name) ? `${BASE}/${name}.svg` : null
}
