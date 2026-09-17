import type {
  FramesResponse,
  Note,
  Practice,
  PracticeDetail,
  PracticeListItem,
  Radar,
  Revision,
} from '../api/types'

const T0 = '2026-01-01T00:00:00Z'

export const radar = (over: Partial<Radar> = {}): Radar => ({
  id: 1,
  name: 'Platform',
  description: null,
  version: 1,
  created_at: T0,
  updated_at: T0,
  archived_at: null,
  ...over,
})

export const practice = (over: Partial<Practice> = {}): Practice => ({
  id: 10,
  name: 'Claude Code',
  slug: 'claude-code',
  category: 'tool',
  summary: 'Agentic coding assistant.',
  body_md: '## Getting started\n\nInstall it.',
  tags: ['agentic'],
  links: [],
  version: 1,
  created_at: T0,
  updated_at: T0,
  archived_at: null,
  ...over,
})

export const listItem = (over: Partial<PracticeListItem> = {}): PracticeListItem => ({
  id: 10,
  name: 'Claude Code',
  slug: 'claude-code',
  category: 'tool',
  summary: 'Agentic coding assistant.',
  tags: ['agentic'],
  archived_at: null,
  radars_count: 0,
  ...over,
})

export const detail = (over: Partial<PracticeDetail> = {}): PracticeDetail => ({
  ...practice(),
  radars: [],
  ...over,
})

export const note = (over: Partial<Note> = {}): Note => ({
  radar_id: 1,
  practice_id: 10,
  body_md: 'We use it for refactors.',
  version: 1,
  updated_at: T0,
  edited_by: null,
  ...over,
})

export const revision = (over: Partial<Revision> = {}): Revision => ({
  id: 100,
  entity_type: 'practice',
  entity_id: '10',
  action: 'create',
  snapshot: { summary: 'Agentic coding assistant.' },
  edited_by: null,
  created_at: T0,
  ...over,
})

export const framesResponse = (over: Partial<FramesResponse> = {}): FramesResponse => ({
  scope: 'radar:1',
  step: 'month',
  frames: [
    {
      date: '2026-01-31T23:59:59Z',
      points: [{ practice_id: 10, adoption: 70, value: 80, radars: 1 }],
    },
    {
      date: '2026-02-28T23:59:59Z',
      points: [
        { practice_id: 10, adoption: 75, value: 85, radars: 1 },
        { practice_id: 11, adoption: 20, value: 60, radars: 1 },
      ],
    },
  ],
  practices: {
    '10': { name: 'Claude Code', category: 'tool' },
    '11': { name: 'Spec-driven dev', category: 'practice' },
  },
  ...over,
})
