import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { FOCUS_HIGHLIGHT_MS, FOCUS_WAIT_MS, useFocusTarget } from './useFocusTarget'

describe('useFocusTarget', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const setup = () => {
    const clear = vi.fn()
    const scope = effectScope()
    const focus = scope.run(() => useFocusTarget({ clear }))!
    return { clear, focus, scope }
  }

  const target = (id: string) => {
    const el = document.createElement('div')
    el.setAttribute('data-focus-device', id)
    el.scrollIntoView = vi.fn()
    document.body.append(el)
    return el
  }

  it('scrolls the target into view, highlights it for a while, then clears the parameter', () => {
    const { clear, focus } = setup()
    const el = target('12')
    focus.show('12')
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'center', behavior: 'smooth' })
    expect(el.hasAttribute('data-focus-flash')).toBe(true)
    vi.advanceTimersByTime(FOCUS_HIGHLIGHT_MS - 1)
    expect(clear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(el.hasAttribute('data-focus-flash')).toBe(false)
    expect(clear).toHaveBeenCalledWith('12')
  })

  it('waits for a target that appears later (a layout still running)', () => {
    const { focus } = setup()
    focus.show('7')
    vi.advanceTimersByTime(200)
    const el = target('7')
    vi.advanceTimersByTime(60)
    expect(el.hasAttribute('data-focus-flash')).toBe(true)
  })

  it('ignores an unknown id silently and still clears it', () => {
    const { clear, focus } = setup()
    focus.show('404')
    vi.advanceTimersByTime(FOCUS_WAIT_MS + 100)
    expect(clear).toHaveBeenCalledWith('404')
  })

  it('jumps without smooth scrolling when motion is reduced', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }))
    const { focus } = setup()
    const el = target('3')
    focus.show('3')
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'center', behavior: 'auto' })
    expect(el.hasAttribute('data-focus-flash')).toBe(true)
    vi.unstubAllGlobals()
  })
})
