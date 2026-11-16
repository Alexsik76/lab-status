import { describe, expect, it } from 'vitest'
import { netboxResponse, statusEntries } from '../__fixtures__'
import { ApiError } from './errors'
import { parseInventoryResponse } from './netbox'
import { parseStatusResponse } from './status'

describe('parseInventoryResponse', () => {
  it('normalizes the real response', () => {
    const inventory = parseInventoryResponse(netboxResponse)
    expect(inventory.vms.length).toBeGreaterThan(0)
  })

  it('surfaces GraphQL errors', () => {
    expect(() => parseInventoryResponse({ errors: [{ message: 'Unauthorized' }] })).toThrow(/Unauthorized/)
  })

  it('rejects a response without inventory data', () => {
    expect(() => parseInventoryResponse({ data: null })).toThrow(ApiError)
    expect(() => parseInventoryResponse({ data: { device_list: [] } })).toThrow(ApiError)
  })
})

describe('parseStatusResponse', () => {
  it('accepts the real response', () => {
    expect(parseStatusResponse(statusEntries)).toHaveLength(statusEntries.length)
  })

  it('accepts an empty list', () => {
    expect(parseStatusResponse([])).toEqual([])
  })

  it('rejects anything that is not a list of checks', () => {
    expect(() => parseStatusResponse({ message: 'Workflow error' })).toThrow(ApiError)
    expect(() => parseStatusResponse([{ name: 'x' }])).toThrow(ApiError)
  })
})
