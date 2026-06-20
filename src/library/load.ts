// ─────────────────────────────────────────────────────────────────────────
// Library loader — discovers the `.md` files and exposes them as a list.
//
// Two sources, merged into one list:
//   • bundled  — `/content/*.md` inlined at build time via Vite's
//     `import.meta.glob('?raw')`. Intentionally EMPTY now (content is phone-
//     imported); the glob stays so dropping seed files back in still works.
//   • imported — `.md` the user picks from the phone at runtime (see
//     `store.ts`); persisted in IndexedDB so they survive WebView reloads.
//     This is the ONLY content source in normal use, and works offline.
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
  /** Source path, e.g. `/content/bilet25.md` or the imported filename. */
  path: string
  frontmatter: Frontmatter
  /** Markdown body with frontmatter stripped. */
  body: string
  /** Raw file text (frontmatter included). */
  raw: string
  /** Where it came from: shipped in the bundle vs imported from the phone. */
  source: 'bundled' | 'imported'
}

// Eager + `?raw`: values are the file contents as strings, keyed by path.
const FILES = import.meta.glob('/content/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function fileStem(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '')
}

/** Parse one raw `.md` string into a `LibraryEntry` (id/title from frontmatter). */
export function makeEntry(raw: string, stem: string, path: string, source: LibraryEntry['source']): LibraryEntry {
  const { frontmatter, body } = parseFrontmatter(raw)
  return {
    id: frontmatter.id?.trim() || stem,
    title: frontmatter.title?.trim() || stem,
    path,
    frontmatter,
    body,
    raw,
    source,
  }
}

/** Natural sort by id so cm-09 precedes cm-25 (not lexicographic 1 < 10 < 2). */
export function sortLibrary(entries: LibraryEntry[]): LibraryEntry[] {
  return entries.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

/**
 * Merge imported entries onto a base list, then sort. An imported file with the
 * same `id` as a bundled one WINS (lets the user override a shipped file), but
 * we never get two rows for one id.
 */
export function mergeLibrary(base: LibraryEntry[], extra: LibraryEntry[]): LibraryEntry[] {
  const byId = new Map(base.map(e => [e.id, e]))
  for (const e of extra) byId.set(e.id, e)
  return sortLibrary([...byId.values()])
}

/** Parse the bundled `/content/*.md` files into a sorted library list. */
export function loadLibrary(): LibraryEntry[] {
  const entries = Object.entries(FILES).map(([path, raw]) => makeEntry(raw, fileStem(path), path, 'bundled'))
  return sortLibrary(entries)
}
