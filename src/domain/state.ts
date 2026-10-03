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
 * - from its own checks first: all up -> up, any down -> down;
 * - offline in NetBox (fallback when no live check exists) -> stopped;
 * - with no check of its own: up when something inside it is up;
 * - everything else -> unknown.
 */
export function resolveState({ offline, serviceStates, childStates }: StateInput): State {
  const checked = serviceStates.filter((s) => s !== 'unknown')
  if (checked.length > 0) {
    return checked.includes('down') ? 'down' : 'up'
  }
  if (offline) return 'stopped'
  return childStates.includes('up') ? 'up' : 'unknown'
}
