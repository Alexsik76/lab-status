import { describe, expect, it } from 'vitest'
import { ageSeconds, bitCount, clockColor, formatAge, rgb, toBits } from './clock'

describe('binary clock helpers', () => {
  it('derives the bit count from the period', () => {
    expect(bitCount(300)).toBe(9)
    expect(bitCount(255)).toBe(8)
    expect(bitCount(256)).toBe(9)
    expect(bitCount(180)).toBe(8)
    expect(bitCount(15)).toBe(4)
    expect(bitCount(1)).toBe(1)
  })

  it('renders a number in binary, most significant bit first', () => {
    expect(toBits(0, 9)).toEqual(Array(9).fill(false))
    expect(toBits(5, 9).map(Number).join('')).toBe('000000101')
    expect(toBits(300, 9).map(Number).join('')).toBe('100101100')
    expect(toBits(511, 9).every(Boolean)).toBe(true)
  })

  it('lights every bit above the largest value', () => {
    expect(toBits(512, 9).every(Boolean)).toBe(true)
    expect(toBits(10_000, 9).every(Boolean)).toBe(true)
  })

  it('counts whole seconds from updatedAt', () => {
    const now = Date.parse('2026-11-17T01:00:12.900Z')
    expect(ageSeconds('2026-11-17T01:00:00Z', now)).toBe(12)
    expect(ageSeconds('2026-11-17T01:00:20Z', now)).toBe(0)
    expect(ageSeconds(null, now)).toBeNull()
    expect(ageSeconds('not a date', now)).toBeNull()
  })

  it('interpolates the colour green -> yellow -> orange-red', () => {
    expect(rgb(clockColor(0))).toBe('rgb(52, 211, 84)')
    expect(rgb(clockColor(0.25))).toBe('rgb(149, 208, 57)')
    expect(rgb(clockColor(0.5))).toBe('rgb(245, 204, 30)')
    expect(rgb(clockColor(0.75))).toBe('rgb(243, 141, 34)')
    expect(rgb(clockColor(1))).toBe('rgb(240, 78, 38)')
    expect(rgb(clockColor(1.7))).toBe('rgb(240, 78, 38)')
    expect(rgb(clockColor(-1))).toBe('rgb(52, 211, 84)')
  })

  it('formats ages', () => {
    expect(formatAge(12)).toBe('12 s ago')
    expect(formatAge(245)).toBe('4 min 5 s ago')
    expect(formatAge(7380)).toBe('2 h 3 min ago')
  })
})
