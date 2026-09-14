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
  Step,
  TeamCreate,
  TeamUpdate,
} from './types'

export type PracticeFilters = {
  q?: string
  category?: Category
  tag?: string
  includeArchived?: boolean
}

export const keys = {
  teams: (includeArchived = false) => ['teams', { includeArchived }] as const,
  team: (id: number) => ['team', id] as const,
  practices: (filters: PracticeFilters = {}) => ['practices', filters] as const,
  practice: (id: number) => ['practice', id] as const,
  similar: (name: string) => ['similar', name] as const,
  note: (teamId: number, practiceId: number) => ['note', teamId, practiceId] as const,
  revisions: (type: EntityType, entityId: string) => ['revisions', type, entityId] as const,
  frames: (scope: string, step: Step) => ['frames', scope, step] as const,
}

// --- Queries -------------------------------------------------------------------

export function useTeams(includeArchived = false) {
  return useQuery({
    queryKey: keys.teams(includeArchived),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/teams', { params: { query: { include_archived: includeArchived } } }),
      ),
  })
}

export function useTeam(id: number | null) {
  return useQuery({
    queryKey: keys.team(id ?? -1),
    enabled: id !== null,
    queryFn: async () =>
      unwrap(await api.GET('/api/teams/{team_id}', { params: { path: { team_id: id! } } })),
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

export function useNote(teamId: number | null, practiceId: number | null) {
  return useQuery({
    queryKey: keys.note(teamId ?? -1, practiceId ?? -1),
    enabled: teamId !== null && practiceId !== null,
    queryFn: async () => {
      const result = await api.GET('/api/teams/{team_id}/notes/{practice_id}', {
        params: { path: { team_id: teamId!, practice_id: practiceId! } },
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
      unwrap(await api.GET('/api/radar/frames', { params: { query: { scope, step } } })),
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

export function useCreateTeam() {
  return useInvalidatingMutation(
    async (body: TeamCreate) => unwrap(await api.POST('/api/teams', { body })),
    () => [['teams']],
  )
}

export function useUpdateTeam() {
  return useInvalidatingMutation(
    async ({ id, body }: { id: number; body: TeamUpdate }) =>
      unwrap(await api.PATCH('/api/teams/{team_id}', { params: { path: { team_id: id } }, body })),
    ({ id }) => [['teams'], keys.team(id)],
  )
}

export function useSetTeamArchived() {
  return useInvalidatingMutation(
    async ({ id, archived }: { id: number; archived: boolean }) => {
      const params = { params: { path: { team_id: id } } }
      return unwrap(
        archived
          ? await api.POST('/api/teams/{team_id}/archive', params)
          : await api.POST('/api/teams/{team_id}/restore', params),
      )
    },
    ({ id }) => [['teams'], keys.team(id), ['frames']],
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
    async (v: { teamId: number; practiceId: number; version: number; body_md: string }) =>
      unwrap(
        await api.PUT('/api/teams/{team_id}/notes/{practice_id}', {
          params: { path: { team_id: v.teamId, practice_id: v.practiceId } },
          body: { version: v.version, body_md: v.body_md },
        }),
      ),
    (v) => [keys.note(v.teamId, v.practiceId), keys.practice(v.practiceId), ['revisions']],
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
