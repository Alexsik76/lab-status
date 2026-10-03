import { describe, expect, it } from 'vitest'
import { formatHardware } from './hardware'

describe('formatHardware', () => {
  it('formats full hardware figures (cores, memory, storage)', () => {
    expect(formatHardware({ cpuCores: 8, memoryGb: 16, storageGb: 512 })).toBe('8c · 16G · 512G')
  })

  it('formats partial hardware figures (cores and memory only)', () => {
    expect(formatHardware({ cpuCores: 8, memoryGb: 15, storageGb: null })).toBe('8c · 15G')
    expect(formatHardware({ cpuCores: 4, memoryGb: 16, storageGb: null })).toBe('4c · 16G')
  })

  it('formats single hardware figure', () => {
    expect(formatHardware({ cpuCores: 4, memoryGb: null, storageGb: null })).toBe('4c')
    expect(formatHardware({ cpuCores: null, memoryGb: 32, storageGb: null })).toBe('32G')
    expect(formatHardware({ cpuCores: null, memoryGb: null, storageGb: 1000 })).toBe('1000G')
  })

  it('returns null when all hardware fields are null', () => {
    expect(formatHardware({ cpuCores: null, memoryGb: null, storageGb: null })).toBeNull()
  })

  it('returns null for null or undefined hardware object', () => {
    expect(formatHardware(null)).toBeNull()
    expect(formatHardware(undefined)).toBeNull()
  })

  it('ignores non-positive or non-numeric values', () => {
    expect(formatHardware({ cpuCores: 0, memoryGb: -1, storageGb: null })).toBeNull()
  })
})
