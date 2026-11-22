import { describe, expect, it } from 'vitest'
import { WAVE_AMPLITUDE, WAVE_HALF, branchPoint, branchPoints, wavyPath } from './wavy'

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

describe('wavyPath', () => {
  it('keeps a segment shorter than one half-wave straight', () => {
    expect(wavyPath([{ x: 0, y: 0 }, { x: 0, y: WAVE_HALF - 1 }])).toBe('M0,0 L0,6')
  })

  it('turns a vertical run into alternating quadratic half-waves of even length', () => {
    const d = wavyPath([{ x: 10, y: 0 }, { x: 10, y: 28 }])
    expect(d).toBe('M10,0 Q3.2,3.5 10,7 Q16.8,10.5 10,14 Q3.2,17.5 10,21 Q16.8,24.5 10,28')
    // Control points sit at twice the amplitude from the route.
    expect(Math.abs(numbers(d)[2] - 10)).toBeCloseTo(2 * WAVE_AMPLITUDE, 5)
  })

  it('turns a horizontal run into half-waves, stretched to divide it evenly', () => {
    const d = wavyPath([{ x: 0, y: 5 }, { x: 20, y: 5 }])
    expect(d).toBe('M0,5 Q5,11.8 10,5 Q15,-1.8 20,5') // 20 / 7 -> 2 half-waves of 10
  })

  it('keeps a corner where the route turns and goes on waving', () => {
    const d = wavyPath([{ x: 0, y: 0 }, { x: 0, y: 14 }, { x: 14, y: 14 }])
    expect(d).toBe('M0,0 Q-6.8,3.5 0,7 Q6.8,10.5 0,14 Q3.5,20.8 7,14 Q10.5,7.2 14,14')
    expect(d.split('Q')).toHaveLength(5)
  })

  it('draws nothing for less than two points', () => {
    expect(wavyPath([{ x: 1, y: 1 }])).toBe('')
  })
})

describe('branch points', () => {
  const port = { x: 100, y: 0 }
  it('finds where two routes from one port part after running together', () => {
    const a = [port, { x: 100, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 60 }]
    const b = [port, { x: 100, y: 30 }, { x: 160, y: 30 }, { x: 160, y: 60 }]
    expect(branchPoint(a, b)).toEqual({ x: 100, y: 30 })
    // Parting in the middle of a shared segment.
    const c = [port, { x: 100, y: 50 }, { x: 160, y: 50 }]
    expect(branchPoint(a, c)).toEqual({ x: 100, y: 30 })
  })

  it('has none when routes part at the port or one is a prefix of the other', () => {
    expect(branchPoint([port, { x: 100, y: 30 }], [port, { x: 140, y: 0 }])).toBeNull()
    expect(branchPoint([port, { x: 100, y: 30 }], [port, { x: 100, y: 30 }, { x: 120, y: 30 }])).toBeNull()
  })

  it('lists each branching point once for several routes', () => {
    const r = (x: number) => [port, { x: 100, y: 30 }, { x, y: 30 }, { x, y: 60 }]
    // 40 parts west at (100,30); 160 and 220 run east together until 160.
    expect(branchPoints([r(40), r(160), r(220), r(40)])).toEqual([{ x: 100, y: 30 }, { x: 160, y: 30 }])
  })
})
