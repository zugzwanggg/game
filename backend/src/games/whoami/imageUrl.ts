/** Upgrade TMDB poster/profile thumbs to a large size for in-game display. */
export function whoAmILargeImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  if (url.includes('image.tmdb.org/t/p/')) {
    return url.replace(/\/t\/p\/[^/]+\//, '/t/p/w1280/')
  }
  return url
}
