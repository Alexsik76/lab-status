import { describe, expect, it } from 'vitest'
import { describeHardware, formatHardware } from './hardware'

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

  it('shows sizes from 1024 GB on in terabytes', () => {
    expect(formatHardware({ cpuCores: 4, memoryGb: 16, storageGb: 5240 })).toBe('4c · 16G · 5.1T')
    expect(formatHardware({ cpuCores: null, memoryGb: null, storageGb: 2048 })).toBe('2T')
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

describe('describeHardware', () => {
  it('spells the figures out for the tooltip', () => {
    expect(describeHardware({ cpuCores: 4, memoryGb: 16, storageGb: 5240 })).toBe(
      '4 CPU cores · 16 GB RAM · 5.1 TB storage',
    )
    expect(describeHardware({ cpuCores: 1, memoryGb: null, storageGb: 240 })).toBe('1 CPU core · 240 GB storage')
  })

  it('returns null when there is nothing to describe', () => {
    expect(describeHardware(null)).toBeNull()
    expect(describeHardware({ cpuCores: null, memoryGb: null, storageGb: null })).toBeNull()
  })
})
