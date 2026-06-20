// ─────────────────────────────────────────────────────────────────────────
// tex2md — convert a raw `cm` ticket `.tex` into the app's `.md` content format
// (see docs/03 "File format"). Shared by the phone-import path (ui/library.ts)
// and the `scripts/tex2md.mjs` CLI, so there is ONE converter.
//
// Pure string/regex work — no dependencies, no DOM — so it runs in well under a
// millisecond on the phone WebView (the heavy step is math rendering at read
// time, not this).
//
// Why this is tractable: math content needs ZERO rewriting — the MathJax
// renderer (`src/render/mathjax.ts`) already teaches itself every custom macro
// from `preamble-compact.tex` (\R \eps \norm \scal \le \diag \sign …), so
// `$…$` / `$$…$$` bodies are kept VERBATIM. Only the prose/structure layer is
// transformed: theorem environments, sections, lists, emphasis, display math.
//
// The ONE thing it can't do faithfully: \eqref / \ref cross-references point at
// numbered equations/definitions that don't exist in the flat teleprompter
// model. They are stripped (with their leading ~) and reported via `warnings`.
// ─────────────────────────────────────────────────────────────────────────

// theorem-like env name → Russian heading word (mirrors preamble-compact.tex).
const THEOREM_ENVS: Record<string, string> = {
  definition: 'Определение',
  theorem: 'Теорема',
  lemma: 'Лемма',
  corollary: 'Следствие',
  proposition: 'Утверждение',
  example: 'Пример',
  remark: 'Замечание',
}

// Math segments are masked before prose transforms so commands INSIDE math
// (\textbf, --, ~, \bigl …) are never touched, then restored at the end.
function maskMath(text: string, store: string[]): string {
  // Display first ($$…$$), then inline ($…$), so the inline pass can't bite
  // into a display block.
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => {
    store.push(m)
    return ` DISP${store.length - 1} `
  })
  text = text.replace(/(?<!\$)\$(?!\$)([\s\S]*?)(?<!\$)\$(?!\$)/g, (_, m) => {
    store.push(m)
    return ` INL${store.length - 1} `
  })
  return text
}

function unmaskMath(text: string, store: string[]): string {
  // Inline → `$…$`; display → fenced `$$` on their own lines (what parseBlocks
  // in src/render/document.ts requires for multi-line display math).
  text = text.replace(/ INL(\d+) /g, (_, i) => `$${store[+i]}$`)
  text = text.replace(/ DISP(\d+) /g, (_, i) => {
    const body = store[+i].replace(/^\s*\n/, '').replace(/\n\s*$/, '')
    return `\n$$\n${body}\n$$\n`
  })
  return text
}

// Convert one \begin{enumerate|itemize}…\end block body into markdown list rows.
function convertList(env: string, body: string): string {
  const items = body.split(/\\item\b/).map(s => s.trim()).filter(Boolean)
  return (
    '\n' +
    items
      .map((it, idx) => (env === 'enumerate' ? `${idx + 1}. ${it}` : `- ${it}`))
      .join('\n') +
    '\n'
  )
}

export interface TexConversion {
  /** Full `.md` text: frontmatter + converted body, ready to store. */
  md: string
  /** Title used in the frontmatter. */
  title: string
  /** Id used in the frontmatter. */
  id: string
  /** Non-fatal issues (dropped cross-refs, leftover commands) for the caller. */
  warnings: string[]
}

/**
 * Convert a raw ticket `.tex` string into the app's `.md` format.
 *
 * `fallbackStem` (e.g. the imported filename without extension) seeds the title
 * and id when the source has no `\bilet{N}{Title}` — so arbitrary `.tex` still
 * imports cleanly instead of throwing.
 */
export function texToMarkdown(tex: string, fallbackStem = 'document'): TexConversion {
  const warnings: string[] = []
  let t = tex.replace(/\r\n/g, '\n')

  // 1. Title + id. Prefer \bilet{N}{Title} (gives a stable cm-NN id); else fall
  //    back to the first \section{…}; else the filename stem.
  let title = fallbackStem
  let id = fallbackStem
  const bilet = t.match(/\\bilet\{(\d+)\}\{((?:[^{}]|\{[^{}]*\})*)\}/)
  if (bilet) {
    title = bilet[2].trim()
    id = `cm-${bilet[1].padStart(2, '0')}`
    t = t.replace(bilet[0], '')
  } else {
    const sec = t.match(/\\section\*?\{((?:[^{}]|\{[^{}]*\})*)\}/)
    if (sec) {
      title = sec[1].trim()
      t = t.replace(sec[0], '')
    } else {
      warnings.push('no \\bilet or \\section — using filename for title/id')
    }
  }

  // 2. Display-math delimiters → $$ (before masking so they get masked too).
  //    NB: a `$$` in a STRING replacement emits a single `$`, so use functions.
  const dollars = () => '\n$$\n'
  // `(?<!\\)` so a row-break-with-spacing `\\[2pt]` inside cases/matrix math is
  // NOT mistaken for a display-open `\[`.
  t = t.replace(/(?<!\\)\\\[/g, dollars).replace(/(?<!\\)\\\]/g, dollars)
  t = t.replace(/\\begin\{equation\*?\}/g, dollars).replace(/\\end\{equation\*?\}/g, dollars)
  // Collapse the just-introduced `$$\n…\n$$` so the bodies mask cleanly.
  t = t.replace(/\$\$\n([\s\S]*?)\n\$\$/g, (_, b) => `$$${b}$$`)

  // 3. Strip every \label (sec/eq/th/def…); they have no target in flat md.
  t = t.replace(/\\label\{[^}]*\}/g, '')

  // 4. Mask all math so prose transforms below never touch formula internals.
  const store: string[] = []
  t = maskMath(t, store)

  // 5. Cross-references: no numbered targets exist → drop (with leading ~/space).
  let refCount = 0
  t = t.replace(/[~ ]?\\(?:eqref|ref)\{[^}]*\}/g, () => {
    refCount++
    return ''
  })
  if (refCount) warnings.push(`${refCount} \\eqref/\\ref dropped — review affected sentences`)

  // 6. Theorem-like environments → bold run-in heading.
  for (const [env, word] of Object.entries(THEOREM_ENVS)) {
    const re = new RegExp(`\\\\begin\\{${env}\\}(?:\\[((?:[^\\[\\]]|\\[[^\\]]*\\])*)\\])?`, 'g')
    t = t.replace(re, (_, opt) => `\n\n**${word}${opt ? ` (${opt.trim()})` : ''}.** `)
    t = t.replace(new RegExp(`\\\\end\\{${env}\\}`, 'g'), '\n')
  }

  // 7. Proof.
  t = t.replace(/\\begin\{proof\}/g, '\n\n*Доказательство.* ').replace(/\\end\{proof\}/g, '\n')

  // 8. Lists (innermost-first via repeated passes; these tickets nest at most once).
  let prev
  do {
    prev = t
    t = t.replace(
      /\\begin\{(enumerate|itemize)\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{\1\}/g,
      (_, env, body) => convertList(env, body),
    )
  } while (t !== prev)

  // 9. Sections / paragraphs.
  t = t.replace(/\\subsection\*?\{([^}]*)\}/g, (_, h) => `\n\n## ${h.trim()}\n`)
  t = t.replace(/\\section\*?\{([^}]*)\}/g, (_, h) => `\n\n# ${h.trim()}\n`)
  t = t.replace(/\\paragraph\{([^}]*)\}\s*/g, (_, h) => `\n\n**${h.replace(/\.\s*$/, '')}.** `)

  // 10. Drop formatting-only commands BEFORE emphasis so e.g. `\emph{\small X}`
  //     trims to `*X*`, not `* X*` (a leading space breaks markdown emphasis).
  t = t.replace(/\\(?:small|normalfont|bfseries|itshape|footnotesize|centering)\b/g, '')

  // 11. Inline emphasis / code (text mode only — math is masked). Trim so a
  //     stray inner space never lands next to the marker.
  t = t.replace(/\\textbf\{([^{}]*)\}/g, (_, s) => `**${s.trim()}**`)
  t = t.replace(/\\(?:emph|textit)\{([^{}]*)\}/g, (_, s) => `*${s.trim()}*`)
  t = t.replace(/\\texttt\{([^{}]*)\}/g, (_, s) => `\`${s.trim()}\``)

  // 12. Text-mode typography (math is still masked, so safe).
  t = t.replace(/~/g, ' ')
  t = t.replace(/---/g, '—').replace(/--/g, '–')
  t = t.replace(/\\,/g, ' ').replace(/\\ /g, ' ')
  t = t.replace(/\\%/g, '%').replace(/\\&/g, '&')

  // 13. Restore math.
  t = unmaskMath(t, store)

  // 14. Whitespace: trim trailing spaces, collapse blank runs.
  t = t
    .split('\n')
    .map(l => l.replace(/[ \t]+$/, ''))
    .join('\n')
  t = t.replace(/\n{3,}/g, '\n\n')
  t = t.replace(/[ \t]{2,}/g, ' ')
  // Pull a bold run-in heading (`**Определение (…).**`) onto the same line as
  // the prose that follows, but not when the next block is math/heading/list.
  t = t.replace(/(\*\*[^*\n]+\.\*\*)\n+(?=[А-Яа-яA-Za-z(])/g, '$1 ')
  t = t.trim()

  const leftover = t.match(/\\[a-zA-Z]+/g)
  if (leftover) {
    const uniq = [...new Set(leftover.filter(c => !/^\\(begin|end)$/.test(c)))]
    // Anything inside math ($…$) is expected; report only what's outside.
    const outside = uniq.filter(c => {
      const idx = t.indexOf(c)
      const before = t.lastIndexOf('$', idx)
      const after = t.indexOf('$', idx)
      return !(before !== -1 && after !== -1 && t.slice(before, idx).split('$').length % 2 === 0)
    })
    if (outside.length) warnings.push(`possible unconverted commands outside math: ${outside.join(' ')}`)
  }

  const md = `---\ntitle: ${title}\nid: ${id}\n---\n\n${t}\n`
  return { md, title, id, warnings }
}
