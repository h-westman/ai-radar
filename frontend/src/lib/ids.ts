/** Parses a bare positive integer id from a URL segment. Anything else is not an id. */
export function parseId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return id > 0 ? id : null
}
