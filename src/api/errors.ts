export type ApiErrorKind = 'invalid'

/** A backend payload the page cannot use, with a message that is safe to show to the user. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind

  constructor(kind: ApiErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ApiError'
    this.kind = kind
  }
}

/** Message for any thrown value, for display in the UI. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
