import type { Category } from '../api/types'

export type CategoryInfo = {
  label: string
  /** Sentence fragment, no trailing period: reads as "Tool — software you install, run or call". */
  description: string
  /** Reads after "like": "…, like Claude Code or an MCP server." */
  example: string
}

export const CATEGORY_INFO: Record<Category, CategoryInfo> = {
  tool: {
    label: 'Tool',
    description: 'software you install, run or call',
    example: 'Claude Code or an MCP server',
  },
  skill: {
    label: 'Skill',
    description: 'something a person gets better at with practice',
    example: 'writing good prompts or reviewing generated code',
  },
  practice: {
    label: 'Practice',
    description: 'a habit your team applies while working',
    example: 'always reviewing AI output before merge',
  },
  workflow: {
    label: 'Workflow',
    description: 'a sequence of steps from start to finish',
    example: 'going from spec to plan to shipped code',
  },
}

export const categoryLabel = (category: Category) => CATEGORY_INFO[category].label

/** One-line option text for a compact <select>: "Tool — software you install, run or call". */
export const categoryOptionText = (category: Category) =>
  `${CATEGORY_INFO[category].label} — ${CATEGORY_INFO[category].description}`
