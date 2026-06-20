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
import { mergeLibrary, type LibraryEntry } from '../library/load'
import { loadImported, putImported, deleteImported } from '../library/store'
import { texToInlineSvg } from '../render'
import { mountReader, type GlassesControl } from './prompter'
import { menuGestureToAction } from '../teleprompter/gestures'
import type { InputEvent } from '../glasses/types'

const md = new MarkdownIt({ html: false, linkify: false, breaks: false })

type Screen =
  | { kind: 'library' }
  | { kind: 'file'; entry: LibraryEntry }
  | { kind: 'reader'; entry: LibraryEntry }

/** A glasses control that does nothing — used when no bridge is connected. */
const NULL_GLASSES: GlassesControl = {
  available: false,
  async enterReading() {},
  async showPage() {},
  async exitReading() {},
  async setStatus() {},
  async setMessage() {},
  onInput() {
    return () => {}
  },
}

export interface AppHooks {
  /** Glasses control: drives the on-glass menu + reader (Iteration 3 / 7). */
  glasses?: GlassesControl
}

/** Handle returned to the host so it can refresh the glasses once connected. */
export interface AppHandle {
  /** Call once the glasses bridge is up — (re)paints the current menu screen. */
  onGlassesReady(): void
}

export function mountApp(root: HTMLElement, hooks: AppHooks = {}): AppHandle {
  // All content is phone-imported; the list starts empty and fills from IndexedDB.
  let library: LibraryEntry[] = []
  const glasses = hooks.glasses ?? NULL_GLASSES
  let screen: Screen = { kind: 'library' }
  // Glasses-only: which library row is highlighted (the phone uses taps instead).
  let menuSel = 0

  // Pull the phone-imported files out of IndexedDB. Async, so the (empty) list
  // paints first; we re-render the library once they arrive.
  void loadImported().then(imported => {
    if (imported.length === 0) return
    library = mergeLibrary(library, imported)
    if (screen.kind === 'library') render()
  })

  // Import `.md` picked from the phone: read text → persist to IndexedDB →
  // merge into the live list. Skips non-`.md` and unreadable files silently.
  const importFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (!/\.md$/i.test(file.name)) continue
      try {
        const entry = await putImported(file.name, await file.text())
        library = mergeLibrary(library, [entry])
      } catch {
        /* skip unreadable file */
      }
    }
    menuSel = 0
    if (screen.kind === 'library') render()
  }

  const removeFile = async (entry: LibraryEntry) => {
    await deleteImported(entry.id)
    library = library.filter(e => e.id !== entry.id)
    if (menuSel >= library.length) menuSel = Math.max(0, library.length - 1)
    render()
  }

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
      renderLibrary(root, library, open, importFiles, removeFile)
    } else if (screen.kind === 'file') {
      renderFile(root, screen.entry, back, read)
    } else {
      const entry = screen.entry
      mountReader(root, entry, glasses, { onBack: () => backToFile(entry) })
    }
    renderGlasses()
  }

  // ── On-glass menu (file selection from the glasses) ──────────────────────────
  // The phone selects by tapping; the glasses drive the SAME flow with gestures.
  // Library: swipe ↑/↓ moves the highlight, tap opens the highlighted file.
  // File:    tap starts reading, double-tap goes back. Reader-mode gestures are
  // owned by the prompter, so this handler ignores them (screen.kind === 'reader').

  /** Paint the current menu screen onto the glasses' native-text region. */
  function renderGlasses() {
    if (screen.kind === 'library') {
      void glasses.setMessage(glassesLibraryText(library, menuSel))
      void glasses.setStatus(library.length === 0 ? 'import .md on the phone' : 'tap — read · swipe — browse')
    } else if (screen.kind === 'file') {
      void glasses.setMessage(`${truncate(screen.entry.title, 24)}\n\ntap — read on glasses`)
      void glasses.setStatus('tap — read · 2× — back')
    }
    // reader: the image tiles own the surface; nothing to push here.
  }

  function handleMenuGesture(event: InputEvent) {
    const action = menuGestureToAction(event.type)
    if (!action) return
    if (screen.kind === 'library') {
      if (library.length === 0) return
      switch (action) {
        case 'up':
          menuSel = (menuSel - 1 + library.length) % library.length
          renderGlasses()
          break
        case 'down':
          menuSel = (menuSel + 1) % library.length
          renderGlasses()
          break
        case 'select':
          read(library[menuSel]) // tap → straight into reading (skip the File screen)
          break
        case 'back':
          break // already at the root
      }
    } else if (screen.kind === 'file') {
      const entry = screen.entry
      switch (action) {
        case 'select':
          read(entry)
          break
        case 'back':
          back()
          break
        case 'up':
        case 'down':
          break // single action on the File screen
      }
    }
    // reader: handled by the prompter's own gesture subscription.
  }

  glasses.onInput(handleMenuGesture)
  render()

  return { onGlassesReady: renderGlasses }
}

// ── On-glass menu text (native-text path, ~25 chars/line) ─────────────────────

/** Truncate to fit the glasses' narrow native text line. */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * Render the library as a windowed native-text list for the glasses. The
 * highlighted row is marked with "> "; the window scrolls to keep the selection
 * roughly centered, so even a 20-file library stays navigable on the ~10 lines
 * the native text path affords.
 */
function glassesLibraryText(library: LibraryEntry[], sel: number): string {
  const total = library.length
  if (total === 0) return 'G2 Math Reader\n\nNo files yet.\nImport .md on the phone.'
  const WINDOW = 5
  const start = Math.max(0, Math.min(sel - (WINDOW >> 1), total - WINDOW))
  const end = Math.min(total, start + WINDOW)
  const rows: string[] = []
  for (let i = start; i < end; i++) {
    rows.push(`${i === sel ? '> ' : '  '}${truncate(library[i].title, 22)}`)
  }
  return `Library  ${sel + 1}/${total}\n\n${rows.join('\n')}`
}

// ── Library screen ───────────────────────────────────────────────────────────

function renderLibrary(
  root: HTMLElement,
  library: LibraryEntry[],
  open: (e: LibraryEntry) => void,
  importFiles: (files: FileList) => void,
  removeFile: (e: LibraryEntry) => void,
) {
  const items = library
    .map(
      (e, i) => `
      <div class="row" data-i="${i}">
        <button class="row-open" data-i="${i}">
          <div class="row-title">${escapeHtml(e.title)}</div>
          <div class="row-meta">${escapeHtml(e.id)} · ${countMath(e.body).display} formulas · ${snippet(e.body)}</div>
        </button>
        <button class="row-del" data-i="${i}" title="Remove">✕</button>
      </div>`,
    )
    .join('')

  root.innerHTML = shell(`
    <h1 class="h1">Library</h1>
    <p class="sub">${library.length} files · tap to open</p>
    <label class="import">
      + Import .md from phone
      <input id="import-input" type="file" accept=".md,text/markdown,text/plain" multiple hidden />
    </label>
    <p class="note">Imported files are stored on the phone (offline) and survive restarts.</p>
    <div class="list">${items || '<p class="sub">No files. Import some <code>.md</code> above.</p>'}</div>
  `)

  root.querySelectorAll<HTMLButtonElement>('.row-open').forEach(btn =>
    btn.addEventListener('click', () => open(library[Number(btn.dataset.i)])),
  )
  root.querySelectorAll<HTMLButtonElement>('.row-del').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation()
      removeFile(library[Number(btn.dataset.i)])
    }),
  )
  const input = root.querySelector<HTMLInputElement>('#import-input')!
  input.addEventListener('change', () => {
    if (input.files && input.files.length) importFiles(input.files)
  })
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
    <button class="back" id="back">← Library</button>
    <h1 class="h1">${escapeHtml(entry.title)}</h1>
    <div class="fm">
      <span><b>id</b> ${escapeHtml(entry.id)}</span>
      <span><b>file</b> <code>${escapeHtml(entry.path)}</code></span>
      <span><b>math</b> ${display} display · ${inline} inline</span>
    </div>
    <button class="read" id="read">▶ Read on glasses</button>
    <div class="doc">${bodyHtml}</div>
    <p class="note">Above is the phone preview (crisp SVG). The «Read on glasses» button
      renders the file to a 4-bit raster and pages through it — iteration 3.</p>
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
  .import { display:block; text-align:center; background:#15240f; color:#9be29b; cursor:pointer;
            border:1px dashed #2f4d22; border-radius:8px; padding:11px; font-size:14px; font-weight:600;
            margin-bottom:6px; }
  .import:hover { background:#1b3013; border-color:#3c6a2c; }
  .list { display:flex; flex-direction:column; gap:8px; }
  .row { display:flex; align-items:stretch; background:#1a1a1a; border:1px solid #333; border-radius:8px;
         overflow:hidden; color:#E5E5E5; }
  .row:hover { border-color:#4a4a4a; background:#202020; }
  .row-open { flex:1; text-align:left; background:none; border:0; color:inherit; cursor:pointer;
              padding:12px 14px; }
  .row-del { background:none; border:0; border-left:1px solid #333; color:#a06a6a; cursor:pointer;
             padding:0 14px; font-size:14px; }
  .row-del:hover { background:#2a1414; color:#e29b9b; }
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
