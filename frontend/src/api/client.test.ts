import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { setEditedBy } from '../lib/editedBy'
import { api, ApiError, conflictCurrent, isConflict, unwrap, validationMessage } from './client'

function captureEditedBy() {
  const seen: (string | null)[] = []
  server.use(
    http.post('/api/radars', ({ request }) => {
      seen.push(request.headers.get('x-edited-by'))
      return HttpResponse.json({ id: 1 }, { status: 201 })
    }),
    http.get('/api/radars', ({ request }) => {
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
    await api.POST('/api/radars', { body: { name: 'X' } })
    await api.GET('/api/radars')
    expect(seen).toEqual(['%C3%85sa%20Lind', null])
  })

  it('omits the header when the name was skipped', async () => {
    const seen = captureEditedBy()
    setEditedBy('')
    await api.POST('/api/radars', { body: { name: 'X' } })
    expect(seen).toEqual([null])
  })

  it('unwrap throws ApiError with the body for conflicts', async () => {
    server.use(
      http.post('/api/radars', () =>
        HttpResponse.json({ detail: 'exists', current: { id: 7 } }, { status: 409 }),
      ),
    )
    const error = await Promise.resolve(api.POST('/api/radars', { body: { name: 'X' } }))
      .then(unwrap)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(isConflict(error)).toBe(true)
    expect(conflictCurrent<{ id: number }>(error as ApiError)).toEqual({ id: 7 })
  })

  it('unwrap returns data for ok responses', async () => {
    server.use(http.get('/api/radars', () => HttpResponse.json([{ id: 1 }])))
    expect(unwrap(await api.GET('/api/radars'))).toEqual([{ id: 1 }])
  })

  describe('validationMessage', () => {
    it('joins loc segments and strips the leading "body" entry for an array detail', () => {
      const error = new ApiError(422, {
        detail: [{ loc: ['body', 'links', 0, 'url'], msg: 'Input should be a valid URL' }],
      })
      expect(validationMessage(error)).toBe('links → 0 → url: Input should be a valid URL')
    })

    it('joins multiple items with "; "', () => {
      const error = new ApiError(422, {
        detail: [
          { loc: ['body', 'name'], msg: 'Field required' },
          { loc: ['body', 'category'], msg: 'Input should be a valid category' },
        ],
      })
      expect(validationMessage(error)).toBe('name: Field required; category: Input should be a valid category')
    })

    it('passes a string detail through unchanged', () => {
      const error = new ApiError(422, { detail: 'Something is invalid' })
      expect(validationMessage(error)).toBe('Something is invalid')
    })

    it('returns null for a non-422 ApiError', () => {
      const error = new ApiError(500, { detail: 'boom' })
      expect(validationMessage(error)).toBeNull()
    })

    it('returns null for a non-ApiError value', () => {
      expect(validationMessage(new Error('nope'))).toBeNull()
    })
  })
})
