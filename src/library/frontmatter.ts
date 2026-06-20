// ─────────────────────────────────────────────────────────────────────────
// Minimal YAML-frontmatter splitter for our `.md` content files.
//
// Format (see docs/03 "File format"):
//   ---
//   title: Билет 25. Метод отражений
//   id: cm-25
//   ---
//   <markdown body with $…$ / $$…$$ math>
//
// We only ever store flat `key: value` scalars in frontmatter, so a full YAML
// parser would be overkill (and a dependency). This reads the leading `---`
// block, returns its keys, and hands back the body with the block stripped.
// ─────────────────────────────────────────────────────────────────────────

export interface Frontmatter {
  title?: string
  id?: string
  [key: string]: string | undefined
}

export interface ParsedMarkdown {
  frontmatter: Frontmatter
  /** Markdown body with the frontmatter block removed and trimmed. */
  body: string
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const KEY_VALUE_RE = /^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$/

/** Strip surrounding matching quotes from a scalar value, if present. */
function unquote(value: string): string {
  const v = value.trim()
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
    return v.slice(1, -1)
  }
  return v
}

export function parseFrontmatter(raw: string): ParsedMarkdown {
  // Strip a UTF-8 BOM so the `---` fence still matches at index 0.
  const text = raw.replace(/^﻿/, '')
  const match = FRONTMATTER_RE.exec(text)
  if (!match) return { frontmatter: {}, body: text.trim() }

  const frontmatter: Frontmatter = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = KEY_VALUE_RE.exec(line)
    if (kv) frontmatter[kv[1]] = unquote(kv[2])
  }
  return { frontmatter, body: text.slice(match[0].length).trim() }
}
