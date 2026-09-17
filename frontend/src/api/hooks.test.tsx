import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { framesResponse, note, radar } from '../test/fixtures'
import { server } from '../test/server'
import { isConflict } from './client'
import { useFrames, useNote, usePlace, useRadars, useUpdatePractice } from './hooks'

// Inlined instead of importing from '../test/render': that module statically pulls in
// '../router' -> pages/components which still import the deleted '../lib/refs' (Tasks 6-8
// fix those). This suite only needs a bare QueryClientProvider wrapper, so it avoids the
// transitive chain entirely.
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
}

function queryWrapper(client = createTestQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('query hooks', () => {
  it('useRadars loads radars', async () => {
    server.use(http.get('/api/radars', () => HttpResponse.json([radar()])))
    const { result } = renderHook(() => useRadars(), { wrapper: queryWrapper() })
    await waitFor(() => expect(result.current.data).toEqual([radar()]))
  })

  it('useNote resolves to null on 404', async () => {
    server.use(
      http.get('/api/radars/1/notes/10', () =>
        HttpResponse.json({ detail: 'Note not found' }, { status: 404 }),
      ),
    )
    const { result } = renderHook(() => useNote(1, 10), { wrapper: queryWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('useNote returns the note', async () => {
    server.use(http.get('/api/radars/1/notes/10', () => HttpResponse.json(note())))
    const { result } = renderHook(() => useNote(1, 10), { wrapper: queryWrapper() })
    await waitFor(() => expect(result.current.data).toEqual(note()))
  })

  it('usePlace refetches frames', async () => {
    let frameCalls = 0
    server.use(
      http.get('/api/frames', () => {
        frameCalls += 1
        return HttpResponse.json(framesResponse())
      }),
      http.post('/api/placements', () => HttpResponse.json({ id: 1 }, { status: 201 })),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(
      () => ({ frames: useFrames('radar:1', 'month'), place: usePlace() }),
      { wrapper: queryWrapper(client) },
    )
    await waitFor(() => expect(result.current.frames.isSuccess).toBe(true))
    await act(() =>
      result.current.place.mutateAsync({ radar_id: 1, practice_id: 10, adoption: 5, value: 5 }),
    )
    await waitFor(() => expect(frameCalls).toBe(2))
  })

  it('useUpdatePractice surfaces conflicts as ApiError', async () => {
    server.use(
      http.patch('/api/practices/10', () =>
        HttpResponse.json({ detail: 'changed', current: { version: 3 } }, { status: 409 }),
      ),
    )
    const { result } = renderHook(() => useUpdatePractice(), { wrapper: queryWrapper() })
    const error = await result.current
      .mutateAsync({ id: 10, body: { version: 1, summary: 'x' } })
      .catch((e: unknown) => e)
    expect(isConflict(error)).toBe(true)
  })
})
