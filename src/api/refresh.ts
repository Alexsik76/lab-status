import { REFRESH_TIMEOUT_MS, REFRESH_URL } from '../config'

/**
 * Asks the backend to run every polling source at once (`POST /api/refresh`, answered 202
 * immediately); the fresh data arrives over the stream. A failure is not reported here:
 * the stream's own state already tells whether the backend is reachable.
 */
export async function requestRefresh(): Promise<void> {
  try {
    await fetch(REFRESH_URL, { method: 'POST', signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) })
  } catch {
    // see above
  }
}
