// ─────────────────────────────────────────────────────────────────────────
// Iteration 2 — Library + file selection (phone WebView UI).
//
// Two screens with a trivial router:
//   • Library — the ~20 content files listed by frontmatter `title`. Tap → File.
//   • File    — the opened file rendered as a readable document: prose via
//               markdown-it, ALL math (inline $…$ + display $$…$$) rendered to
//               crisp MathJax SVG. This is a human preview on the phone, so it
//               stays sharp/scalable — NOT the 4-bit dithered glasses output.
//
// The actual on-glasses reading view (the whole document → 4-bit images, paged
// and auto-scrolled) is Iteration 3. This screen is phone-only and proves the
// `.md` format round-trips through load → parse → render.
// ─────────────────────────────────────────────────────────────────────────

import MarkdownIt from 'markdown-it'
import { loadLibrary, type LibraryEntry } from '../library/load'
import { texToInlineSvg } from '../render'
import { mountReader, type GlassesControl } from './prompter'

const md = new MarkdownIt({ html: false, linkify: false, breaks: false })

type Screen =
  | { kind: 'library' }
  | { kind: 'file'; entry: LibraryEntry }
  | { kind: 'reader'; entry: LibraryEntry }

/** What screen the phone is on — so the host can mirror it onto the glasses. */
export type ScreenInfo =
  | { kind: 'library'; count: number }
  | { kind: 'file'; title: string; id: string }
  | { kind: 'reader'; title: string; id: string }

/** A glasses control that does nothing — used when no bridge is connected. */
const NULL_GLASSES: GlassesControl = {
  available: false,
  async enterReading() {},
  async showPage() {},
  async exitReading() {},
  async setStatus() {},
  onInput() {
    return () => {}
  },
}

export interface AppHooks {
  /** Fired on every navigation, so the caller can reflect state on-glass. */
  onScreenChange?: (info: ScreenInfo) => void
  /** Glasses control passed through to the reader screen (Iteration 3). */
  glasses?: GlassesControl
}

export function mountApp(root: HTMLElement, hooks: AppHooks = {}): void {
  const library = loadLibrary()
  const glasses = hooks.glasses ?? NULL_GLASSES
  let screen: Screen = { kind: 'library' }

  const open = (entry: LibraryEntry) => {
    screen = { kind: 'file', entry }
    render()
  }
  const read = (entry: LibraryEntry) => {
    screen = { kind: 'reader', entry }
    render()
  }
  const back = () => {
    screen = { kind: 'library' }
    render()
  }
  const backToFile = (entry: LibraryEntry) => {
    screen = { kind: 'file', entry }
    render()
  }

  function render() {
    if (screen.kind === 'library') {
      renderLibrary(root, library, open)
      hooks.onScreenChange?.({ kind: 'library', count: library.length })
    } else if (screen.kind === 'file') {
      renderFile(root, screen.entry, back, read)
      hooks.onScreenChange?.({ kind: 'file', title: screen.entry.title, id: screen.entry.id })
    } else {
      const entry = screen.entry
      hooks.onScreenChange?.({ kind: 'reader', title: entry.title, id: entry.id })
      mountReader(root, entry, glasses, { onBack: () => backToFile(entry) })
    }
  }

  render()
}

// ── Library screen ───────────────────────────────────────────────────────────

function renderLibrary(root: HTMLElement, library: LibraryEntry[], open: (e: LibraryEntry) => void) {
  const items = library
    .map(
      (e, i) => `
      <button class="row" data-i="${i}">
        <div class="row-title">${escapeHtml(e.title)}</div>
        <div class="row-meta">${escapeHtml(e.id)} · ${countMath(e.body).display} формул · ${snippet(e.body)}</div>
      </button>`,
    )
    .join('')

  root.innerHTML = shell(`
    <h1 class="h1">Библиотека</h1>
    <p class="sub">${library.length} файлов · нажмите, чтобы открыть</p>
    <div class="list">${items || '<p class="sub">Нет файлов в <code>/content</code>.</p>'}</div>
  `)

  root.querySelectorAll<HTMLButtonElement>('.row').forEach(btn =>
    btn.addEventListener('click', () => open(library[Number(btn.dataset.i)])),
  )
}

// ── File screen ──────────────────────────────────────────────────────────────

function renderFile(root: HTMLElement, entry: LibraryEntry, back: () => void, read: (e: LibraryEntry) => void) {
  const segments = segmentBody(entry.body)
  const { display, inline } = countMath(entry.body)

  const bodyHtml = segments
    .map(seg =>
      seg.type === 'prose'
        ? `<div class="prose">${renderProse(seg.text)}</div>`
        : `<figure class="math">${mathDisplay(seg.latex)}</figure>`,
    )
    .join('')

  root.innerHTML = shell(`
    <button class="back" id="back">← Библиотека</button>
    <h1 class="h1">${escapeHtml(entry.title)}</h1>
    <div class="fm">
      <span><b>id</b> ${escapeHtml(entry.id)}</span>
      <span><b>файл</b> <code>${escapeHtml(entry.path)}</code></span>
      <span><b>математика</b> ${display} display · ${inline} inline</span>
    </div>
    <button class="read" id="read">▶ Читать на очках</button>
    <div class="doc">${bodyHtml}</div>
    <p class="note">Сверху — превью на телефоне (чёткий SVG). Кнопка «Читать на очках»
      рендерит файл в 4-bit растр и листает его постранично — итерация 3.</p>
  `)

  root.querySelector('#back')!.addEventListener('click', back)
  root.querySelector('#read')!.addEventListener('click', () => read(entry))
}

/** LaTeX → crisp inline/display SVG for the phone preview (falls back to source). */
function mathInline(latex: string): string {
  try {
    return `<span class="imath">${texToInlineSvg(latex, false)}</span>`
  } catch {
    return `<code class="imath-src">${escapeHtml(`$${latex}$`)}</code>`
  }
}

function mathDisplay(latex: string): string {
  try {
    return texToInlineSvg(latex, true)
  } catch {
    return `<code class="err">render error: ${escapeHtml(latex)}</code>`
  }
}

// ── Body parsing (CONFIRMATION-only; the real slicer is Iteration 3) ──────────

type Segment = { type: 'prose'; text: string } | { type: 'math'; latex: string }

const DISPLAY_MATH_RE = /\$\$([\s\S]+?)\$\$/g
const INLINE_MATH_RE = /(?<!\$)\$(?!\$)([^$\n]+?)\$/g

/** Split the body into prose runs and `$$…$$` display-math blocks, in order. */
function segmentBody(body: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of body.matchAll(DISPLAY_MATH_RE)) {
    const start = m.index ?? 0
    if (start > last) out.push({ type: 'prose', text: body.slice(last, start) })
    out.push({ type: 'math', latex: m[1].trim() })
    last = start + m[0].length
  }
  if (last < body.length) out.push({ type: 'prose', text: body.slice(last) })
  return out
}

function countMath(body: string): { display: number; inline: number } {
  const display = (body.match(DISPLAY_MATH_RE) || []).length
  // Count inline math outside display blocks.
  const withoutDisplay = body.replace(DISPLAY_MATH_RE, ' ')
  const inline = (withoutDisplay.match(INLINE_MATH_RE) || []).length
  return { display, inline }
}

/**
 * Render prose as markdown, protecting inline `$…$` from markdown's emphasis.
 * The placeholder uses plain `@@M…@@` ASCII tokens: markdown-it leaves them
 * untouched, so the restore always matches. (Earlier whitespace/NUL-delimited
 * schemes broke — markdown trims spaces and sanitizes NUL → U+FFFD — and the
 * tokens leaked into the page as visible junk.)
 */
function renderProse(text: string): string {
  const maths: string[] = []
  const guarded = text.replace(INLINE_MATH_RE, (_, m: string) => `@@M${maths.push(m) - 1}@@`)
  const html = md.render(guarded)
  return html.replace(/@@M(\d+)@@/g, (_, i: string) => mathInline(maths[+i]))
}

/** First prose words of a body, for the library row preview. */
function snippet(body: string): string {
  const text = body
    .replace(DISPLAY_MATH_RE, ' ')
    .replace(/^#.*$/gm, '')
    .replace(/[*`_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return escapeHtml(text.slice(0, 64) + (text.length > 64 ? '…' : ''))
}

// ── Shell + helpers ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function shell(inner: string): string {
  return `<main class="screen">${inner}</main>${STYLE}`
}

const STYLE = `<style>
  .screen { margin:auto; padding:18px 16px 40px; max-width:680px; width:100%; box-sizing:border-box;
            font-family:system-ui,-apple-system,sans-serif; }
  .h1 { font-size:19px; font-weight:600; margin:0 0 4px; color:#E5E5E5; }
  .sub { color:#919191; font-size:13px; margin:0 0 14px; }
  .list { display:flex; flex-direction:column; gap:8px; }
  .row { text-align:left; background:#1a1a1a; border:1px solid #333; border-radius:8px;
         padding:12px 14px; cursor:pointer; color:#E5E5E5; }
  .row:hover { border-color:#4a4a4a; background:#202020; }
  .row-title { font-size:15px; font-weight:600; color:#9be29b; }
  .row-meta { font-size:12px; color:#8a8a8a; margin-top:4px; }
  .back { background:#2a2a2a; color:#e5e5e5; border:1px solid #444; border-radius:6px;
          padding:7px 12px; font-size:13px; cursor:pointer; margin-bottom:12px; }
  .read { display:block; width:100%; box-sizing:border-box; background:#15240f; color:#9be29b;
          border:1px solid #2f4d22; border-radius:8px; padding:12px; font-size:15px; font-weight:600;
          cursor:pointer; margin-bottom:14px; }
  .read:hover { background:#1b3013; border-color:#3c6a2c; }
  .fm { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:12px; color:#9a9a9a;
        background:#161616; border:1px solid #2c2c2c; border-radius:8px; padding:10px 12px; margin-bottom:14px; }
  .fm b { color:#9be29b; font-weight:600; }
  .doc { display:flex; flex-direction:column; gap:6px; }
  .prose { color:#d6d6d6; font-size:14px; line-height:1.55; }
  .prose h2 { font-size:15px; color:#cfe9cf; margin:14px 0 4px; }
  .prose p { margin:6px 0; }
  .prose ol, .prose ul { margin:6px 0; padding-left:22px; }
  /* Inline math: crisp SVG (currentColor → light), scales with the prose font. */
  .imath { color:#f0f0f0; }
  .imath svg { vertical-align:-0.25ex; }
  .imath-src { background:#15240f; color:#9be29b; padding:0 3px; border-radius:3px;
               font:12px ui-monospace,Menlo,monospace; }
  /* Display math: centered, slightly larger, theme-green. */
  .math { margin:10px 0; padding:12px 10px; background:#101510; border:1px solid #2c2c2c;
          border-radius:8px; display:flex; justify-content:center; overflow-x:auto; color:#bfe6bf; }
  .math svg { font-size:118%; }
  .note { color:#7a7a7a; font-size:11.5px; margin:16px 0 0; line-height:1.4; }
  .err { color:#e29b9b; font:12px ui-monospace,monospace; }
  code { font-family:ui-monospace,Menlo,monospace; }
</style>`
