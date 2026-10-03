import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { useLiveSource } from './useLiveSource'

function deferred<T>() {
  let resolve!: (val: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useLiveSource', () => {
  it('shows loading phase on very first load before data arrives', async () => {
    const d = deferred<string[]>()
    const source = useLiveSource({
      fetcher: () => d.promise,
    })

    expect(source.phase.value).toBe('loading')
    expect(source.data.value).toBeNull()
    expect(source.isLoading.value).toBe(true)

    d.resolve(['item1'])
    await nextTick()
    await nextTick()

    expect(source.phase.value).toBe('ready')
    expect(source.data.value).toEqual(['item1'])
    expect(source.isLoading.value).toBe(false)
  })

  it('shows failed phase on very first load if fetch fails', async () => {
    const d = deferred<string[]>()
    const source = useLiveSource({
      fetcher: () => d.promise,
    })

    expect(source.phase.value).toBe('loading')
    d.reject(new Error('Network error'))
    await nextTick()
    await nextTick()

    expect(source.phase.value).toBe('failed')
    expect(source.data.value).toBeNull()
    expect(source.errorMessage.value).toBe('Network error')
  })

  it('proves that data is not cleared while a refresh is in flight', async () => {
    let currentData = ['val-A']
    let nextDeferred = deferred<string[]>()

    const source = useLiveSource({
      fetcher: () => nextDeferred.promise,
      indexer: (items) => items.join(','),
      defaultIndex: '',
    })

    // 1. Initial load finishes
    nextDeferred.resolve(currentData)
    await nextTick()
    await nextTick()

    expect(source.data.value).toEqual(['val-A'])
    expect(source.index.value).toBe('val-A')
    expect(source.phase.value).toBe('ready')

    // 2. Start a refresh with a slow/deferred promise
    nextDeferred = deferred<string[]>()
    const refreshPromise = source.refresh()
    await nextTick()

    expect(source.isLoading.value).toBe(true)
    // CRITICAL: previous data and index MUST be retained during in-flight refresh!
    expect(source.data.value).toEqual(['val-A'])
    expect(source.index.value).toBe('val-A')
    // Phase remains ready so UI does not show "pending / checking…"
    expect(source.phase.value).toBe('ready')

    // 3. New data arrives and replaces old data
    nextDeferred.resolve(['val-B', 'val-C'])
    await refreshPromise
    await nextTick()

    expect(source.isLoading.value).toBe(false)
    expect(source.data.value).toEqual(['val-B', 'val-C'])
    expect(source.index.value).toBe('val-B,val-C')
    expect(source.phase.value).toBe('ready')
  })

  it('proves that a failed refresh keeps the last data and reports failed phase', async () => {
    let nextDeferred = deferred<string[]>()

    const source = useLiveSource({
      fetcher: () => nextDeferred.promise,
      indexer: (items) => items.length,
      defaultIndex: 0,
    })

    // Initial load succeeds
    nextDeferred.resolve(['entry1', 'entry2'])
    await nextTick()
    await nextTick()

    expect(source.data.value).toEqual(['entry1', 'entry2'])
    expect(source.index.value).toBe(2)
    expect(source.phase.value).toBe('ready')

    // Refresh fails
    nextDeferred = deferred<string[]>()
    const refreshPromise = source.refresh()
    nextDeferred.reject(new Error('500 Internal Server Error'))
    await refreshPromise
    await nextTick()
    await nextTick()

    expect(source.isLoading.value).toBe(false)
    // CRITICAL: previous data and index MUST NOT be cleared on failure!
    expect(source.data.value).toEqual(['entry1', 'entry2'])
    expect(source.index.value).toBe(2)
    // Phase is failed so the existing notice banner is displayed
    expect(source.phase.value).toBe('failed')
    expect(source.errorMessage.value).toBe('500 Internal Server Error')
  })
})
