import type { ServiceState, State } from './model'

export interface StateInput {
  /** NetBox status is "offline". */
  offline: boolean
  /** States of this node's own services (`unknown` = no check for it). */
  serviceStates: readonly ServiceState[]
  /** States of everything inside this node. */
  childStates: readonly State[]
}

/**
 * State rules:
 * - own checks with at least one up: all up -> up, any down -> down;
 * - offline in NetBox (no up check) -> stopped, even if checks are down;
 * - own checks, none up, not offline: any down -> down;
 * - with no check of its own: up when something inside it is up;
 * - everything else -> unknown.
 */
export function resolveState({ offline, serviceStates, childStates }: StateInput): State {
  const checked = serviceStates.filter((s) => s !== 'unknown')
  if (checked.includes('up')) return checked.includes('down') ? 'down' : 'up'
  if (offline) return 'stopped'
  if (checked.includes('down')) return 'down'
  return childStates.includes('up') ? 'up' : 'unknown'
}