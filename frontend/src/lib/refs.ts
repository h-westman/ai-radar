export function toRef(id: number, slug: string): string {
  return `${id}-${slug}`
}

export function idFromRef(ref: string | undefined): number | null {
  const match = ref?.match(/^(\d+)(?:-|$)/)
  return match ? Number(match[1]) : null
}
