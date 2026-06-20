// ─────────────────────────────────────────────────────────────────────────
// Library loader — discovers the ~20 `.md` files and exposes them as a list.
//
// Files live in `/content/*.md` (project root). Vite's `import.meta.glob` with
// `?raw` inlines each file's text at build time, so the whole library ships in
// the bundle — no fetch, no filesystem, works in the phone WebView offline.
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
  /** Source path, e.g. `/content/bilet25.md` (shown for debugging). */
  path: string
  frontmatter: Frontmatter
  /** Markdown body with frontmatter stripped. */
  body: string
  /** Raw file text (frontmatter included). */
  raw: string
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

/** Parse every content file into a sorted library list. */
export function loadLibrary(): LibraryEntry[] {
  const entries = Object.entries(FILES).map(([path, raw]): LibraryEntry => {
    const { frontmatter, body } = parseFrontmatter(raw)
    const stem = fileStem(path)
    return {
      id: frontmatter.id?.trim() || stem,
      title: frontmatter.title?.trim() || stem,
      path,
      frontmatter,
      body,
      raw,
    }
  })
  // Natural sort by id so cm-09 precedes cm-25 (not lexicographic 1 < 10 < 2).
  entries.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  return entries
}
