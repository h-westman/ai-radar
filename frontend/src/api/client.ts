import createClient, { type Middleware } from 'openapi-fetch'
import { getEditedBy } from '../lib/editedBy'
import type { paths } from './schema'

export const editedByMiddleware: Middleware = {
  onRequest({ request }) {
    const name = getEditedBy()
    if (name && request.method !== 'GET') {
      request.headers.set('X-Edited-By', encodeURIComponent(name))
    }
    return request
  },
}

export const api = createClient<paths>({
  baseUrl: window.location.origin,
  // Look up `fetch` lazily instead of capturing `globalThis.fetch` at import
  // time: this module is imported before MSW's `server.listen()` patches the
  // global in tests, so an eagerly-captured reference would bypass mocking.
  fetch: (request) => globalThis.fetch(request),
})
api.use(editedByMiddleware)

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`)
    this.status = status
    this.body = body
  }
}

export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (!result.response.ok) throw new ApiError(result.response.status, result.error)
  return result.data as T
}

export function isConflict(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 409
}

export function conflictCurrent<T>(e: ApiError): T | null {
  const body = e.body as { current?: T | null } | undefined
  return body?.current ?? null
}
