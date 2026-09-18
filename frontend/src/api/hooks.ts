import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { api, unwrap } from './client'
import type {
  Category,
  EntityType,
  PlacementCreate,
  PracticeCreate,
  PracticeUpdate,
  RadarCreate,
  RadarUpdate,
  Step,
} from './types'

export type PracticeFilters = {
  q?: string
  category?: Category
  tag?: string
  includeArchived?: boolean
}

export const keys = {
  radars: (includeArchived = false) => ['radars', { includeArchived }] as const,
  radar: (id: number) => ['radar', id] as const,
  practices: (filters: PracticeFilters = {}) => ['practices', filters] as const,
  practice: (id: number) => ['practice', id] as const,
  similar: (name: string) => ['similar', name] as const,
  note: (radarId: number, practiceId: number) => ['note', radarId, practiceId] as const,
  revisions: (type: EntityType, entityId: string) => ['revisions', type, entityId] as const,
  frames: (scope: string, step: Step) => ['frames', scope, step] as const,
}

// --- Queries -------------------------------------------------------------------

export function useRadars(includeArchived = false) {
  return useQuery({
    queryKey: keys.radars(includeArchived),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/radars', { params: { query: { include_archived: includeArchived } } }),
      ),
  })
}

export function useRadar(id: number | null) {
  return useQuery({
    queryKey: keys.radar(id ?? -1),
    enabled: id !== null,
    queryFn: async () =>
      unwrap(await api.GET('/api/radars/{radar_id}', { params: { path: { radar_id: id! } } })),
  })
}

export function usePractices(filters: PracticeFilters = {}) {
  return useQuery({
    queryKey: keys.practices(filters),
    placeholderData: keepPreviousData,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/practices', {
          params: {
            query: {
              q: filters.q || undefined,
              category: filters.category,
              tag: filters.tag || undefined,
              include_archived: filters.includeArchived ?? false,
            },
          },
        }),
      ),
  })
}

export function usePractice(id: number | null) {
  return useQuery({
    queryKey: keys.practice(id ?? -1),
    enabled: id !== null,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/practices/{practice_id}', { params: { path: { practice_id: id! } } }),
      ),
  })
}

export function useSimilar(name: string) {
  const trimmed = name.trim()
  return useQuery({
    queryKey: keys.similar(trimmed),
    enabled: trimmed.length >= 2,
    queryFn: async () =>
      unwrap(await api.GET('/api/practices/similar', { params: { query: { name: trimmed } } })),
  })
}

export function useNote(radarId: number | null, practiceId: number | null) {
  return useQuery({
    queryKey: keys.note(radarId ?? -1, practiceId ?? -1),
    enabled: radarId !== null && practiceId !== null,
    queryFn: async () => {
      const result = await api.GET('/api/radars/{radar_id}/notes/{practice_id}', {
        params: { path: { radar_id: radarId!, practice_id: practiceId! } },
      })
      if (result.response.status === 404) return null
      return unwrap(result)
    },
  })
}

export function useRevisions(type: EntityType, entityId: string | null) {
  return useQuery({
    queryKey: keys.revisions(type, entityId ?? ''),
    enabled: entityId !== null,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/revisions', {
          params: { query: { entity_type: type, entity_id: entityId! } },
        }),
      ),
  })
}

export function useFrames(scope: string, step: Step) {
  return useQuery({
    queryKey: keys.frames(scope, step),
    placeholderData: keepPreviousData,
    queryFn: async () =>
      unwrap(await api.GET('/api/frames', { params: { query: { scope, step } } })),
  })
}

// --- Mutations -----------------------------------------------------------------

function useInvalidatingMutation<TVars, TData>(
  mutationFn: (vars: TVars) => Promise<TData>,
  invalidate: (vars: TVars) => QueryKey[],
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async (_data, vars) => {
      await Promise.all(
        invalidate(vars).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      )
    },
  })
}

export function useCreateRadar() {
  return useInvalidatingMutation(
    async (body: RadarCreate) => unwrap(await api.POST('/api/radars', { body })),
    () => [['radars']],
  )
}

export function useUpdateRadar() {
  return useInvalidatingMutation(
    async ({ id, body }: { id: number; body: RadarUpdate }) =>
      unwrap(
        await api.PATCH('/api/radars/{radar_id}', { params: { path: { radar_id: id } }, body }),
      ),
    ({ id }) => [['radars'], keys.radar(id)],
  )
}

export function useSetRadarArchived() {
  return useInvalidatingMutation(
    async ({ id, archived }: { id: number; archived: boolean }) => {
      const params = { params: { path: { radar_id: id } } }
      return unwrap(
        archived
          ? await api.POST('/api/radars/{radar_id}/archive', params)
          : await api.POST('/api/radars/{radar_id}/restore', params),
      )
    },
    ({ id }) => [['radars'], keys.radar(id), ['frames']],
  )
}

export function useCreatePractice() {
  return useInvalidatingMutation(
    async (body: PracticeCreate) => unwrap(await api.POST('/api/practices', { body })),
    () => [['practices'], ['similar']],
  )
}

export function useUpdatePractice() {
  return useInvalidatingMutation(
    async ({ id, body }: { id: number; body: PracticeUpdate }) =>
      unwrap(
        await api.PATCH('/api/practices/{practice_id}', {
          params: { path: { practice_id: id } },
          body,
        }),
      ),
    ({ id }) => [['practices'], keys.practice(id), ['frames'], ['revisions']],
  )
}

export function useSetPracticeArchived() {
  return useInvalidatingMutation(
    async ({ id, archived }: { id: number; archived: boolean }) => {
      const params = { params: { path: { practice_id: id } } }
      return unwrap(
        archived
          ? await api.POST('/api/practices/{practice_id}/archive', params)
          : await api.POST('/api/practices/{practice_id}/restore', params),
      )
    },
    ({ id }) => [['practices'], keys.practice(id), ['frames'], ['revisions']],
  )
}

export function usePlace() {
  return useInvalidatingMutation(
    async (body: PlacementCreate) => unwrap(await api.POST('/api/placements', { body })),
    ({ practice_id }) => [['frames'], ['practices'], keys.practice(practice_id)],
  )
}

export function usePutNote() {
  return useInvalidatingMutation(
    async (v: { radarId: number; practiceId: number; version: number; body_md: string }) =>
      unwrap(
        await api.PUT('/api/radars/{radar_id}/notes/{practice_id}', {
          params: { path: { radar_id: v.radarId, practice_id: v.practiceId } },
          body: { version: v.version, body_md: v.body_md },
        }),
      ),
    (v) => [keys.note(v.radarId, v.practiceId), keys.practice(v.practiceId), ['revisions']],
  )
}

export function useRevert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (revisionId: number) =>
      unwrap(
        await api.POST('/api/revisions/{revision_id}/revert', {
          params: { path: { revision_id: revisionId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
