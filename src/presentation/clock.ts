/**
 * The binary refresh clock in the header: the age of the data in whole seconds, in binary.
 * Pure helpers; the component only draws them.
 */

export type Rgb = readonly [number, number, number]

export const CLOCK_GREEN: Rgb = [52, 211, 84]
export const CLOCK_YELLOW: Rgb = [245, 204, 30]
export const CLOCK_RED: Rgb = [240, 78, 38]

/** The smallest number of bits whose largest value holds the period (9 for 300 s). */
export function bitCount(periodS: number): number {
  let bits = 1
  while (2 ** bits - 1 < periodS) bits += 1
  return bits
}

/** Bits of `value`, most significant first; a value too large lights every bit. */
export function toBits(value: number, bits: number): boolean[] {
  const max = 2 ** bits - 1
  const n = Math.min(Math.max(0, Math.floor(value)), max)
  return Array.from({ length: bits }, (_, i) => ((n >> (bits - 1 - i)) & 1) === 1)
}

/** Whole seconds since `updatedAt` (never negative). */
export function ageSeconds(updatedAt: string | Date | null | undefined, now: number): number | null {
  if (!updatedAt) return null
  const at = typeof updatedAt === 'string' ? Date.parse(updatedAt) : updatedAt.getTime()
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.floor((now - at) / 1000))
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as unknown as Rgb

/**
 * Colour of the lit bits by the fraction of the period elapsed: green at 0, yellow at 0.5,
 * orange-red at 1 and after, linear in RGB.
 */
export function clockColor(fraction: number): Rgb {
  const f = Math.min(Math.max(fraction, 0), 1)
  return f <= 0.5 ? mix(CLOCK_GREEN, CLOCK_YELLOW, f / 0.5) : mix(CLOCK_YELLOW, CLOCK_RED, (f - 0.5) / 0.5)
}

export const rgb = ([r, g, b]: Rgb): string => `rgb(${r}, ${g}, ${b})`

/** "12 s ago", "4 min 5 s ago", "2 h 3 min ago". */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ${seconds % 60} s ago`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`
}
