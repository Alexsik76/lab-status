import type { Point } from './topologyLayout'

/** Wi-Fi line: amplitude and half-wavelength of the wave, in canvas units. */
export const WAVE_AMPLITUDE = 3.4
export const WAVE_HALF = 7

const fmt = (n: number) => String(Math.round(n * 10) / 10)

/**
 * An orthogonal route as a wavy SVG path: every straight segment becomes a run of quadratic
 * curves, one per half-wave, alternating sides, so the line crosses the route at each half-wave
 * end. The half-waves of a segment are stretched to divide it evenly; a segment shorter than
 * one half-wave stays straight. Corners stay where ELK put them.
 */
export function wavyPath(points: readonly Point[], amplitude = WAVE_AMPLITUDE, half = WAVE_HALF): string {
  if (points.length < 2) return ''
  let d = `M${fmt(points[0].x)},${fmt(points[0].y)}`
  let sign = 1
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.floor(len / half)
    if (n < 1) {
      d += ` L${fmt(b.x)},${fmt(b.y)}`
      continue
    }
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    // Normal to the segment; the control point sits at twice the amplitude (a quadratic curve
    // reaches half way to its control point).
    const nx = -uy
    const ny = ux
    const step = len / n
    for (let k = 0; k < n; k++) {
      const mid = (k + 0.5) * step
      const end = (k + 1) * step
      const cx = a.x + ux * mid + nx * 2 * amplitude * sign
      const cy = a.y + uy * mid + ny * 2 * amplitude * sign
      d += ` Q${fmt(cx)},${fmt(cy)} ${fmt(a.x + ux * end)},${fmt(a.y + uy * end)}`
      sign = -sign
    }
  }
  return d
}

const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5

/**
 * Where two routes from the same port part ways after running together (ELK merges the first
 * stretch of edges that share a port). Null when they part at the port itself or when one
 * route is a prefix of the other.
 */
export function branchPoint(a: readonly Point[], b: readonly Point[]): Point | null {
  if (a.length < 2 || b.length < 2 || !same(a[0], b[0])) return null
  let cur = a[0]
  let i = 1
  let j = 1
  let travelled = 0
  while (i < a.length && j < b.length) {
    const da = { x: Math.sign(Math.round(a[i].x - cur.x)), y: Math.sign(Math.round(a[i].y - cur.y)) }
    const db = { x: Math.sign(Math.round(b[j].x - cur.x)), y: Math.sign(Math.round(b[j].y - cur.y)) }
    if (da.x === 0 && da.y === 0) {
      i++
      continue
    }
    if (db.x === 0 && db.y === 0) {
      j++
      continue
    }
    if (da.x !== db.x || da.y !== db.y) return travelled > 0 ? cur : null
    const la = Math.hypot(a[i].x - cur.x, a[i].y - cur.y)
    const lb = Math.hypot(b[j].x - cur.x, b[j].y - cur.y)
    const next = la <= lb ? a[i] : b[j]
    travelled += Math.min(la, lb)
    cur = next
    if (same(cur, a[i])) i++
    if (same(cur, b[j])) j++
  }
  return null
}

/** The branching points of several routes from one port (each point once). */
export function branchPoints(routes: readonly (readonly Point[])[]): Point[] {
  const out: Point[] = []
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const p = branchPoint(routes[i], routes[j])
      if (p && !out.some((q) => same(p, q))) out.push(p)
    }
  }
  return out
}
