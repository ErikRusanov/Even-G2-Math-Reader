// ─────────────────────────────────────────────────────────────────────────
// Content-hashed in-memory cache.
//
// Rendering a whole file to dithered, tiled page bitmaps is the expensive step;
// we never want to repeat it for a file already rendered this session (re-opening
// from the library, bouncing back from a sub-screen, etc.). So the page model
// memoizes its result keyed by a hash of (render version + file id + body), and
// this module owns that hashing + memo table.
//
// In-memory only (lives as long as the WebView). Persisting across reloads
// (IndexedDB) is Iteration 6.
// ─────────────────────────────────────────────────────────────────────────

// Stores the in-flight/settled promise per key, so concurrent calls for the
// same key share one computation rather than racing two renders.
const store = new Map<string, Promise<unknown>>()

/** Fast, stable, non-cryptographic string hash (FNV-1a, 32-bit, hex). */
export function hashContent(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Run `fn` once per key; later calls with the same key return the cached value.
 *  A failed computation is evicted so a later call can retry. */
export function memoize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = store.get(key)
  if (existing) return existing as Promise<T>
  const value = fn().catch(err => {
    store.delete(key)
    throw err
  })
  store.set(key, value)
  return value
}

/** Drop everything (e.g. after a render-parameter change). */
export function clearCache(): void {
  store.clear()
}
