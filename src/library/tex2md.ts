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
  // The delimiter spaces are OPTIONAL on restore: prose transforms (list items,
  // theorem run-ins, flattened table cells) trim text and can strip a token's
  // surrounding space — without the `?` those tokens would leak as literal
  // `INL7`/`DISP3`. With one space present it's consumed exactly as before, so
  // inter-word spacing is preserved.
  text = text.replace(/ ?INL(\d+) ?/g, (_, i) => `$${store[+i]}$`)
  text = text.replace(/ ?DISP(\d+) ?/g, (_, i) => {
    const body = store[+i]
      .replace(/^\s*\n/, '')
      .replace(/\n\s*$/, '')
      .replace(/\n[ \t]*\n/g, '\n') // blank lines break MathJax inside $$…$$
    return `\n$$\n${body}\n$$\n`
  })
  return text
}

// Read `count` brace-balanced `{…}` arguments starting at/after `from` (skipping
// leading whitespace). Returns the arg bodies (without the outer braces) and the
// index just past the last `}`, or null if the braces don't balance. Used to
// parse commands whose arguments nest braces more than one level deep — a regex
// with fixed nesting can't (e.g. `\bilet{63}{… $\mathbb{R}^1$ …}`).
function readBraceArgs(text: string, from: number, count: number): { args: string[]; end: number } | null {
  let i = from
  const args: string[] = []
  for (let a = 0; a < count; a++) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (text[i] !== '{') return null
    let depth = 0
    const start = i + 1
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    if (depth !== 0) return null
    args.push(text.slice(start, i))
    i++ // step past the closing brace
  }
  return { args, end: i }
}

// Unwrap every `\name{…}` (one brace-balanced arg) via `fn`. Brace-balanced so
// the arg may contain nested braces or (post-mask) masked-math tokens.
function unwrapCommand(text: string, name: string, fn: (arg: string) => string): string {
  const marker = `\\${name}`
  let out = ''
  let i = 0
  while (i < text.length) {
    const at = text.indexOf(marker, i)
    if (at === -1) {
      out += text.slice(i)
      break
    }
    const r = readBraceArgs(text, at + marker.length, 1)
    if (!r) {
      out += text.slice(i, at + marker.length)
      i = at + marker.length
      continue
    }
    out += text.slice(i, at) + fn(r.args[0])
    i = r.end
  }
  return out
}

// \texorpdfstring{TEX}{PDF} (hyperref) — gives a heading both a rich (math) form
// and a plain-text fallback for contexts that can't render math (PDF bookmarks).
// Our system has the SAME split: the BODY renders math, so it keeps arg 0 (the
// TeX form) via this helper; the TITLE is plain text and uses the dedicated
// resolveTexorpdfstringTitle below. Brace-balanced (args may nest, e.g.
// `{$\mathbb{R}^1$}`) and recursive (nested \texorpdfstring inside the arg).
function resolveTexorpdfstring(s: string, which: 0 | 1): string {
  const marker = '\\texorpdfstring'
  let out = ''
  let i = 0
  while (i < s.length) {
    const at = s.indexOf(marker, i)
    if (at === -1) {
      out += s.slice(i)
      break
    }
    out += s.slice(i, at)
    const r = readBraceArgs(s, at + marker.length, 2)
    if (!r) {
      out += marker
      i = at + marker.length
      continue
    }
    out += r.args[which]
    i = r.end
  }
  return out.includes(marker) ? resolveTexorpdfstring(out, which) : out
}

// Resolve \texorpdfstring for a TITLE (a text-only context). Per occurrence:
// when the TeX (math) arg is JUST a single Greek letter (`$\alpha$`), use the
// Unicode symbol (α reads better than the author's ASCII "alpha"); otherwise use
// the PDF/plain-text arg, which the author hand-wrote for exactly this case and
// handles complex forms best (`$x_{k+1}=Bx_k+c$` → "x(k+1)=B x(k)+c").
function resolveTexorpdfstringTitle(s: string): string {
  const marker = '\\texorpdfstring'
  let out = ''
  let i = 0
  while (i < s.length) {
    const at = s.indexOf(marker, i)
    if (at === -1) {
      out += s.slice(i)
      break
    }
    out += s.slice(i, at)
    const r = readBraceArgs(s, at + marker.length, 2)
    if (!r) {
      out += marker
      i = at + marker.length
      continue
    }
    const greek = r.args[0].trim().match(/^\$\\([a-zA-Z]+)\$$/)
    out += greek && TITLE_MATH_UNICODE[greek[1]] ? TITLE_MATH_UNICODE[greek[1]] : r.args[1]
    i = r.end
  }
  return out.includes(marker) ? resolveTexorpdfstringTitle(out) : out
}

// Greek + a few symbols → Unicode, for the rare bare `$…$` left in a TITLE (a
// text-only context). Most title math is wrapped in \texorpdfstring and already
// resolved to plain text by the time this runs; this is just a safe fallback.
const TITLE_MATH_UNICODE: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', infty: '∞',
}

/** Collapse a bare `$…$` math body to readable plain text for a title. */
function titleMathToPlain(math: string): string {
  return math
    .replace(/\\(?:mathbb|mathcal|mathrm|text|mathbf)\b/g, '') // keep the wrapped letters
    .replace(/\\([a-zA-Z]+)/g, (_, name) => TITLE_MATH_UNICODE[name] ?? '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalize an extracted title to plain text (math resolved, TeX typography). */
function cleanTitle(title: string): string {
  let s = resolveTexorpdfstringTitle(title) // PDF arg, but lone Greek → symbol
  s = s.replace(/\$([^$]+)\$/g, (_, m) => titleMathToPlain(m)) // any bare math left
  s = s.replace(/---/g, '—').replace(/--/g, '–')
  s = s.replace(/~/g, ' ').replace(/\\[,! ]/g, ' ')
  return s.replace(/\s{2,}/g, ' ').trim()
}

// Convert one \begin{enumerate|itemize}…\end block body into markdown list rows.

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
  //    back to the first \section{…}; else the filename stem. Both are read with
  //    brace-balanced parsing so a title with nested braces (e.g. a math arg like
  //    `$\mathbb{R}^1$` or `$x_{k+1}$`) is captured whole — a fixed-nesting regex
  //    silently failed on those, losing the cm-NN id and leaking \bilet{…}.
  let title = fallbackStem
  let id = fallbackStem
  const biletAt = t.match(/\\bilet\b/)
  const biletArgs = biletAt ? readBraceArgs(t, biletAt.index! + biletAt[0].length, 2) : null
  if (biletAt && biletArgs) {
    id = `cm-${biletArgs.args[0].trim().padStart(2, '0')}`
    title = biletArgs.args[1].trim()
    t = t.slice(0, biletAt.index!) + t.slice(biletArgs.end)
  } else {
    const secAt = t.match(/\\section\*?/)
    const secArgs = secAt ? readBraceArgs(t, secAt.index! + secAt[0].length, 1) : null
    if (secAt && secArgs) {
      title = secArgs.args[0].trim()
      t = t.slice(0, secAt.index!) + t.slice(secArgs.end)
    } else {
      warnings.push('no \\bilet or \\section — using filename for title/id')
    }
  }

  // 1b. \texorpdfstring: the TITLE is plain text everywhere it's shown → take the
  //     PDF (plain-text) arg + normalize typography; the BODY renders math → keep
  //     the TeX arg verbatim.
  title = cleanTitle(title)
  t = resolveTexorpdfstring(t, 0)

  // 2. Display-math delimiters → $$ (before masking so they get masked too).
  //    NB: a `$$` in a STRING replacement emits a single `$`, so use functions.
  const dollars = () => '\n$$\n'
  // `(?<!\\)` so a row-break-with-spacing `\\[2pt]` inside cases/matrix math is
  // NOT mistaken for a display-open `\[`.
  t = t.replace(/(?<!\\)\\\[/g, dollars).replace(/(?<!\\)\\\]/g, dollars)
  // \(…\) inline-math delimiters → $…$ (some author notes use these instead of
  // $). `(?<!\\)` guards a `\\(` row-break-then-paren inside math.
  t = t.replace(/(?<!\\)\\\(/g, '$').replace(/(?<!\\)\\\)/g, '$')
  t = t.replace(/\\begin\{equation\*?\}/g, dollars).replace(/\\end\{equation\*?\}/g, dollars)
  // align / align* → display math wrapping an `aligned` env (MathJax renders the
  // alignment; a bare `align` isn't valid inside `$$`).
  t = t.replace(/\\begin\{align\*?\}/g, () => '\n$$\n\\begin{aligned}\n')
  t = t.replace(/\\end\{align\*?\}/g, () => '\n\\end{aligned}\n$$\n')
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

  // 5b. Custom `cm` author commands (Cyrillic-named). Both wrap text + masked
  //     math, so unwrap post-mask (brace-balanced; the arg holds INL/DISP tokens):
  //       \проверить{…}    — editorial "verify against source" caveat
  //       \нетисточника{…} — "no source available" note (the whole body of the
  //                          heat-equation stub tickets 20–22)
  //     Kept (not dropped) as italic notes so no authored caveat is lost.
  t = unwrapCommand(t, 'проверить', s => ` *(проверить: ${s.trim()})* `)
  t = unwrapCommand(t, 'нетисточника', s => `*(нет источника: ${s.trim()})*`)

  // 6. Theorem-like environments → bold run-in heading.
  for (const [env, word] of Object.entries(THEOREM_ENVS)) {
    const re = new RegExp(`\\\\begin\\{${env}\\}(?:\\[((?:[^\\[\\]]|\\[[^\\]]*\\])*)\\])?`, 'g')
    t = t.replace(re, (_, opt) => `\n\n**${word}${opt ? ` (${opt.trim()})` : ''}.** `)
    t = t.replace(new RegExp(`\\\\end\\{${env}\\}`, 'g'), '\n')
  }

  // 7. Proof.
  t = t.replace(/\\begin\{proof\}/g, '\n\n*Доказательство.* ').replace(/\\end\{proof\}/g, '\n')

  // 7b. Tables: the glasses typesetter has no table support, so flatten a
  //     `tabular` (cell math already masked) into one text line per row, cells
  //     joined by " | "; drop the `center` wrapper and rules. Runs post-mask so
  //     `$…$` cells survive; `&`/`\\`/`\hline` are text-mode, still present here.
  t = t.replace(/\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/g, (_, body: string) => {
    const rows = body
      .replace(/\\hline/g, '')
      .split(/\\\\/)
      .map((r: string) => r.trim())
      .filter(Boolean)
      .map((r: string) => r.split('&').map((c: string) => c.trim()).join(' | '))
    return `\n\n${rows.join('\n')}\n\n`
  })
  t = t.replace(/\\(?:begin|end)\{center\}/g, '\n')

  // 8. Lists (innermost-first via repeated passes; these tickets nest at most once).
  let prev
  do {
    prev = t
    t = t.replace(
      /\\begin\{(enumerate|itemize)\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{\1\}/g,
      (_, env, body) => convertList(env, body),
    )
  } while (t !== prev)

  // 9. Sections / paragraphs (subsubsection before subsection so the deeper one
  //    isn't half-matched).
  t = t.replace(/\\subsubsection\*?\{([^}]*)\}/g, (_, h) => `\n\n### ${h.trim()}\n`)
  t = t.replace(/\\subsection\*?\{([^}]*)\}/g, (_, h) => `\n\n## ${h.trim()}\n`)
  t = t.replace(/\\section\*?\{([^}]*)\}/g, (_, h) => `\n\n# ${h.trim()}\n`)
  t = t.replace(/\\paragraph\{([^}]*)\}\s*/g, (_, h) => `\n\n**${h.replace(/\.\s*$/, '')}.** `)

  // 10. Drop formatting-only commands BEFORE emphasis so e.g. `\emph{\small X}`
  //     trims to `*X*`, not `* X*` (a leading space breaks markdown emphasis).
  t = t.replace(
    /\\(?:small|normalfont|bfseries|itshape|footnotesize|centering|medskip|smallskip|bigskip|noindent|indent|par)\b/g,
    '',
  )

  // 11. Inline emphasis / code (text mode only — math is masked). Trim so a
  //     stray inner space never lands next to the marker.
  t = t.replace(/\\textbf\{([^{}]*)\}/g, (_, s) => `**${s.trim()}**`)
  t = t.replace(/\\(?:emph|textit)\{([^{}]*)\}/g, (_, s) => `*${s.trim()}*`)
  t = t.replace(/\\texttt\{([^{}]*)\}/g, (_, s) => `\`${s.trim()}\``)
  // \textup / \textrm / \textnormal: upright text wrapper — keep content, drop it.
  t = t.replace(/\\(?:textup|textrm|textnormal|textsf)\{([^{}]*)\}/g, (_, s) => s)

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
