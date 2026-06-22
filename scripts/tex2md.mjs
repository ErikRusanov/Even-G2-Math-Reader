#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// tex2md CLI — thin wrapper over the shared converter in src/library/tex2md.ts
// (the same code the phone-import path uses, so there is ONE converter).
//
// Node strips the TypeScript types on import (Node ≥23.6 does this by default).
//
// Usage:
//   node scripts/tex2md.mjs ../cm/tickets-compact/bilet09.tex            # → stdout
//   node scripts/tex2md.mjs ../cm/tickets-compact/bilet09.tex content/   # → content/bilet09.md
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { texToMarkdown } from '../src/library/tex2md.ts'

// Recursively inline `\input{…}` / `\include{…}` (relative to the including file,
// `.tex` optional) so a multi-file standalone doc — e.g. tutorial.tex pulling in
// tutorial_sec/sec1..7.tex — converts as one. Preamble inputs are left literal:
// the converter strips everything before \begin{document}, so they vanish there.
// (The phone-import path takes a single .tex and has no filesystem, so input
// inlining lives here in the CLI, keeping the shared converter pure.)
function inlineInputs(tex, baseDir, seen = new Set()) {
  return tex.replace(/\\(?:input|include)\{([^}]+)\}/g, (m, p) => {
    let rel = p.trim()
    if (/(^|\/)preamble/i.test(rel)) return m
    if (!/\.\w+$/.test(rel)) rel += '.tex'
    const abs = resolve(baseDir, rel)
    if (seen.has(abs)) return ''
    seen.add(abs)
    try {
      return inlineInputs(readFileSync(abs, 'utf8'), dirname(abs), seen)
    } catch {
      console.error(`[tex2md] \\input not found, left literal: ${rel}`)
      return m
    }
  })
}

const [, , src, outDir] = process.argv
if (!src) {
  console.error('usage: node scripts/tex2md.mjs <ticket.tex> [outDir]')
  process.exit(1)
}
const stem = basename(src).replace(/\.tex$/, '')
const raw = inlineInputs(readFileSync(src, 'utf8'), dirname(resolve(src)))
const { md, warnings } = texToMarkdown(raw, stem)
for (const w of warnings) console.error(`[${stem}] ${w}`)
if (outDir) {
  const out = join(outDir, `${stem}.md`)
  writeFileSync(out, md)
  console.error(`[${stem}] wrote ${out}`)
} else {
  process.stdout.write(md)
}
