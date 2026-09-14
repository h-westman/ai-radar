import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { setEditedBy } from '../lib/editedBy'
import { api, ApiError, conflictCurrent, isConflict, unwrap } from './client'

function captureEditedBy() {
  const seen: (string | null)[] = []
  server.use(
    http.post('/api/teams', ({ request }) => {
      seen.push(request.headers.get('x-edited-by'))
      return HttpResponse.json({ id: 1 }, { status: 201 })
    }),
    http.get('/api/teams', ({ request }) => {
      seen.push(request.headers.get('x-edited-by'))
      return HttpResponse.json([])
    }),
  )
  return seen
}

describe('api client', () => {
  it('sends the URL-encoded name on writes only', async () => {
    const seen = captureEditedBy()
    setEditedBy('Åsa Lind')
    await api.POST('/api/teams', { body: { name: 'X' } })
    await api.GET('/api/teams')
    expect(seen).toEqual(['%C3%85sa%20Lind', null])
  })

  it('omits the header when the name was skipped', async () => {
    const seen = captureEditedBy()
    setEditedBy('')
    await api.POST('/api/teams', { body: { name: 'X' } })
    expect(seen).toEqual([null])
  })

  it('unwrap throws ApiError with the body for conflicts', async () => {
    server.use(
      http.post('/api/teams', () =>
        HttpResponse.json({ detail: 'exists', current: { id: 7 } }, { status: 409 }),
      ),
    )
    const error = await Promise.resolve(api.POST('/api/teams', { body: { name: 'X' } }))
      .then(unwrap)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(isConflict(error)).toBe(true)
    expect(conflictCurrent<{ id: number }>(error as ApiError)).toEqual({ id: 7 })
  })

  it('unwrap returns data for ok responses', async () => {
    server.use(http.get('/api/teams', () => HttpResponse.json([{ id: 1 }])))
    expect(unwrap(await api.GET('/api/teams'))).toEqual([{ id: 1 }])
  })
})
