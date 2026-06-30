/** Build the /entity/* target for a legacy /pages/* URL, preserving slug, query, hash. */
export function legacyToEntityPath(slug: string, search: string, hash: string): string {
  return `/entity/${slug}${search}${hash}`;
}
