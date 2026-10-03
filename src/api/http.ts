import { ApiError } from './errors'

export interface FetchJsonOptions {
  /** Human-readable name of the remote system, used in error messages. */
  source: string
  timeoutMs: number
  init?: RequestInit
}

/** `fetch` + JSON with a timeout and every failure mapped to an `ApiError`. */
export async function fetchJson<T>(url: string, { source, timeoutMs, init }: FetchJsonOptions): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'TimeoutError') {
      throw new ApiError('timeout', `${source} did not respond within ${timeoutMs / 1000} s.`, { cause })
    }
    throw new ApiError('network', `${source} is unreachable.`, { cause })
  }

  if (!response.ok) {
    throw new ApiError('http', `${source} responded with HTTP ${response.status} ${response.statusText}`.trim() + '.')
  }

  try {
    return (await response.json()) as T
  } catch (cause) {
    throw new ApiError('invalid', `${source} returned a response that is not valid JSON.`, { cause })
  }
}
