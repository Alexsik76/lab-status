import type { Container, Guest, LabTree, Machine, ServiceItem, Stack, State } from './model'

/**
 * The tree as it may be shown while the status stream is down: every live answer (`up`,
 * `down`) becomes `unknown` and nothing blinks, so last-known data never passes for current.
 * `stopped` stays: it is what the inventory or the last poll said, and it is already drawn
 * as inactive. Everything else (names, images, metrics) is kept as last received.
 */
export function markUnknown(tree: LabTree): LabTree {
  return { machines: tree.machines.map(machine), unplaced: tree.unplaced.map(container) }
}

const unknown = (state: State): State => (state === 'stopped' ? state : 'unknown')

const service = (s: ServiceItem): ServiceItem => ({ ...s, state: 'unknown' })

function container(c: Container): Container {
  return { ...c, state: unknown(c.state), blinking: false, services: c.services.map(service) }
}

function stack(s: Stack): Stack {
  return { ...s, state: unknown(s.state), containers: s.containers.map(container) }
}

function guest(g: Guest): Guest {
  return {
    ...g,
    state: unknown(g.state),
    blinking: false,
    services: g.services.map(service),
    stacks: g.stacks.map(stack),
    standalone: g.standalone.map(container),
  }
}

function machine(m: Machine): Machine {
  return {
    ...m,
    state: unknown(m.state),
    services: m.services.map(service),
    guests: m.guests.map(guest),
    apps: m.apps.map(container),
  }
}
