import type { Container, Guest, Machine } from './domain/model'

export function formatMemory(memoryMb: number): string {
  return memoryMb >= 1024 && memoryMb % 1024 === 0 ? `${memoryMb / 1024} GB` : `${memoryMb} MB`
}

const compact = (parts: (string | null | undefined | false)[]): string[] =>
  parts.filter((p): p is string => typeof p === 'string' && p !== '')

export function machineDetails(m: Machine): string[] {
  return compact([[m.manufacturer, m.model].filter(Boolean).join(' '), m.ip, m.platform])
}

export function guestDetails(g: Guest): string[] {
  return compact([
    g.kind,
    g.vcpus !== null && `${g.vcpus} vCPU`,
    g.memoryMb !== null && `${formatMemory(g.memoryMb)} RAM`,
    g.ip,
    g.platform,
  ])
}

export function containerDetails(c: Container): string[] {
  return compact([c.image && `image: ${c.image}`])
}
