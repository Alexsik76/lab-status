import { describe, expect, it } from 'vitest'
import { resolveState } from './state'
import type { ServiceState, State } from './model'

const resolve = (
  serviceStates: ServiceState[] = [],
  childStates: State[] = [],
  offline = false,
) => resolveState({ offline, serviceStates, childStates })

describe('resolveState', () => {
  it('is stopped when NetBox says offline, whatever the checks say', () => {
    expect(resolve(['up'], ['up'], true)).toBe('stopped')
    expect(resolve([], [], true)).toBe('stopped')
  })

  it('is up when all checked services are up', () => {
    expect(resolve(['up', 'up'])).toBe('up')
  })

  it('is down when any checked service is down', () => {
    expect(resolve(['up', 'down'])).toBe('down')
    expect(resolve(['down'])).toBe('down')
  })

  it('ignores services without a check when others are checked', () => {
    expect(resolve(['up', 'unknown'])).toBe('up')
    expect(resolve(['down', 'unknown'])).toBe('down')
  })

  it('prefers its own checks over what is inside it', () => {
    expect(resolve(['down'], ['up', 'up'])).toBe('down')
    expect(resolve(['up'], ['down'])).toBe('up')
  })

  it('without own checks is up when something inside is up', () => {
    expect(resolve([], ['down', 'up'])).toBe('up')
    expect(resolve(['unknown'], ['unknown', 'up'])).toBe('up')
  })

  it('is unknown when nothing can tell', () => {
    expect(resolve()).toBe('unknown')
    expect(resolve(['unknown'], ['unknown', 'stopped'])).toBe('unknown')
    expect(resolve([], ['down', 'stopped'])).toBe('unknown')
  })
})
