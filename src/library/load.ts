// ─────────────────────────────────────────────────────────────────────────
// Library loader — parses `.md` text into list entries.
//
// All content is phone-imported: the user picks `.md` from the phone at runtime
// (see `store.ts`); files are persisted in IndexedDB so they survive WebView
// reloads and work fully offline. There is NO build-time bundling — dropping
// files in `/content/` does nothing; import them through the app instead.
//
// Only frontmatter (`title`, `id`) is needed to BUILD the list; the body is
// kept on each entry so opening a file is instant (no second load). Heavy work
// (math render, slicing) happens later, only for the opened file.
// ─────────────────────────────────────────────────────────────────────────

import { parseFrontmatter, type Frontmatter } from './frontmatter'

export interface LibraryEntry {
  /** Stable id from frontmatter `id:`, else the filename stem. Used as key. */
  id: string
  /** Display title from frontmatter `title:`, else the filename stem. */
  title: string
  /** Source path — the imported filename. */
  path: string
  frontmatter: Frontmatter
  /** Markdown body with frontmatter stripped. */
  body: string
  /** Raw file text (frontmatter included). */
  raw: string
}

/** Parse one raw `.md` string into a `LibraryEntry` (id/title from frontmatter). */
export function makeEntry(raw: string, stem: string, path: string): LibraryEntry {
  const { frontmatter, body } = parseFrontmatter(raw)
  return {
    id: frontmatter.id?.trim() || stem,
    title: frontmatter.title?.trim() || stem,
    path,
    frontmatter,
    body,
    raw,
  }
}

/** Natural sort by id so cm-09 precedes cm-25 (not lexicographic 1 < 10 < 2). */
export function sortLibrary(entries: LibraryEntry[]): LibraryEntry[] {
  return entries.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

/**
 * Merge extra entries onto a base list, then sort. A later entry with the same
 * `id` WINS (re-importing a file overwrites the old one), so we never get two
 * rows for one id.
 */
export function mergeLibrary(base: LibraryEntry[], extra: LibraryEntry[]): LibraryEntry[] {
  const byId = new Map(base.map(e => [e.id, e]))
  for (const e of extra) byId.set(e.id, e)
  return sortLibrary([...byId.values()])
}
