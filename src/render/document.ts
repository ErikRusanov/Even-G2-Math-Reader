// ─────────────────────────────────────────────────────────────────────────
// Document ribbon renderer — a whole `.md` file → full-surface page bitmaps.
//
// This is the Iteration 3 core: turn an interleaved prose+math document into a
// sequence of 576×288 black-on-white page canvases, laid out as a teleprompter
// ribbon. Pages are full-surface (the glasses' true 576×288), so each page is
// later dithered once and tiled into the 4 image containers (see slice.ts).
//
// Layout is a small hand-rolled typesetter on Canvas 2D — we CANNOT use the DOM
// (rasterizing arbitrary HTML needs SVG <foreignObject>, which taints the canvas
// on WebKit and breaks the dither/encode read-back). So:
//   parseBlocks()   .md text → heading / paragraph / list / display-math blocks
//   tokenizeInline()prose → boxes (words + inline-math) and breakable glue
//   layout          wrap boxes into lines at the working width, measure heights
//   paginate        pack rows into 576×288 pages (never splits a display formula)
//   render          draw each page black-on-white; caller inverts+dithers+tiles
//
// Math (inline AND display) is rasterized via texToImage (MathJax SVG → <img>),
// drawn black-on-white and baseline-aligned with the prose. The whole ribbon is
// inverted to white-on-black downstream, so glyphs end up bright-green-on-dark.
// ─────────────────────────────────────────────────────────────────────────

import { texToImage, encodePng, type RasterMath } from './index'
import { SURFACE } from '../glasses/types'

export interface DocRenderConfig {
  pageW: number
  pageH: number
  /** Inner margin on every edge of a page. */
  pad: number
  /** Body prose font size (px) and the family used for Cyrillic-capable text. */
  fontPx: number
  fontFamily: string
  /** Extra leading added on top of each line's glyph extent. */
  lineGap: number
  /** Heading font size (px). */
  headingPx: number
  /** Vertical gap inserted between top-level blocks. */
  blockGap: number
  /** Glyph scale (px per math ex) for display vs inline math. */
  displayPxPerEx: number
  inlinePxPerEx: number
}

// Calibrated from Iterations 1–2 (pxPerEx≈8 reads cleanly at 4-bit). Prose font
// is ~2× the inline math ex so x-heights roughly match; ~8–9 lines fit a page,
// inside the 24–32 px/line legibility budget from docs/02.
export const DEFAULT_DOC_CONFIG: DocRenderConfig = {
  pageW: SURFACE.width,
  pageH: SURFACE.height,
  pad: 12,
  fontPx: 19,
  fontFamily: '-apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  lineGap: 9,
  headingPx: 23,
  blockGap: 10,
  displayPxPerEx: 9,
  inlinePxPerEx: 8,
}

// ── Block parsing ────────────────────────────────────────────────────────────

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'listitem'; marker: string; text: string }
  | { kind: 'displaymath'; latex: string }

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const LISTITEM_RE = /^\s*(\d+\.|[-*])\s+(.*)$/
const DISPLAY_INLINE_RE = /^\s*\$\$(.+?)\$\$\s*$/

/** Split a markdown body into ordered blocks (a tiny, forgiving parser). */
export function parseBlocks(body: string): Block[] {
  const lines = body.split('\n')
  const blocks: Block[] = []
  let para: string[] = []

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'para', text: para.join(' ').trim() })
      para = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Display math: a fenced `$$` block spanning several lines, or one-liner.
    if (trimmed === '$$') {
      flushPara()
      const buf: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== '$$') buf.push(lines[i++])
      blocks.push({ kind: 'displaymath', latex: buf.join('\n').trim() })
      continue
    }
    const inlineDisplay = trimmed.match(DISPLAY_INLINE_RE)
    if (inlineDisplay) {
      flushPara()
      blocks.push({ kind: 'displaymath', latex: inlineDisplay[1].trim() })
      continue
    }

    if (trimmed === '') {
      flushPara()
      continue
    }

    const heading = trimmed.match(HEADING_RE)
    if (heading) {
      flushPara()
      blocks.push({ kind: 'heading', text: heading[2].trim() })
      continue
    }

    const item = trimmed.match(LISTITEM_RE)
    if (item) {
      flushPara()
      const marker = /^\d/.test(item[1]) ? item[1] : '•'
      blocks.push({ kind: 'listitem', marker, text: item[2].trim() })
      continue
    }

    para.push(trimmed)
  }
  flushPara()
  return blocks
}

// ── Inline tokenizing ─────────────────────────────────────────────────────────

type InlineToken =
  | { type: 'word'; text: string }
  | { type: 'math'; latex: string }
  | { type: 'glue' } // a breakable space

// Inline math `$…$` but not `$$…$$`; mirrors the splitter used in the phone UI.
const INLINE_MATH_RE = /(?<!\$)\$(?!\$)([^$\n]+?)\$/g

/** Strip the markdown emphasis/code markers we don't render at 4-bit. */
function stripEmphasis(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+?)`/g, '$1')
    .replace(/_(.+?)_/g, '$1')
}

/** Prose string → words, inline-math, and breakable glue, in source order. */
export function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = []
  const pushText = (chunk: string) => {
    const clean = stripEmphasis(chunk)
    // Split on whitespace, keeping the gaps as glue.
    const parts = clean.split(/(\s+)/)
    for (const part of parts) {
      if (part === '') continue
      if (/^\s+$/.test(part)) out.push({ type: 'glue' })
      else out.push({ type: 'word', text: part })
    }
  }

  let last = 0
  for (const m of text.matchAll(INLINE_MATH_RE)) {
    const start = m.index ?? 0
    if (start > last) pushText(text.slice(last, start))
    out.push({ type: 'math', latex: m[1].trim() })
    last = start + m[0].length
  }
  if (last < text.length) pushText(text.slice(last))
  return out
}

// ── Layout primitives ──────────────────────────────────────────────────────────

/** A laid-out "box" on a line: a word or an inline-math image. */
interface Box {
  width: number
  ascent: number
  descent: number
  draw(ctx: CanvasRenderingContext2D, x: number, baseline: number): void
}

/** A finished row in the ribbon — knows its own height and how to paint itself. */
interface Row {
  height: number
  /** True for inter-block spacers, which are dropped at a page top. */
  spacer?: boolean
  draw(ctx: CanvasRenderingContext2D, yTop: number): void
}

const TEXT_ASCENT = (px: number) => Math.round(px * 0.8)
const TEXT_DESCENT = (px: number) => Math.round(px * 0.22)

/** Greedy line-break: boxes+glue → rows, wrapped at maxWidth, hung at indent. */
function wrapBoxes(
  cfg: DocRenderConfig,
  boxes: Array<Box | 'glue'>,
  font: string,
  maxWidth: number,
  spaceWidth: number,
  indent: number,
  hangingIndent: number,
): Row[] {
  const rows: Row[] = []
  let line: Array<{ box: Box; x: number }> = []
  let x = indent
  let pendingGlue = false

  const flush = () => {
    if (!line.length) return
    const ascent = Math.max(...line.map(e => e.box.ascent))
    const descent = Math.max(...line.map(e => e.box.descent))
    const height = ascent + descent + cfg.lineGap
    const entries = line
    rows.push({
      height,
      draw(ctx, yTop) {
        const baseline = yTop + ascent
        ctx.font = font
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = '#000000'
        for (const e of entries) e.box.draw(ctx, e.x, baseline)
      },
    })
    line = []
  }

  for (const item of boxes) {
    if (item === 'glue') {
      pendingGlue = line.length > 0
      continue
    }
    const advance = (pendingGlue ? spaceWidth : 0) + item.width
    if (line.length && x + advance > maxWidth) {
      flush()
      x = indent + hangingIndent
      pendingGlue = false
    }
    if (pendingGlue) x += spaceWidth
    line.push({ box: item, x })
    x += item.width
    pendingGlue = false
  }
  flush()
  return rows
}

// ── Page rendering ──────────────────────────────────────────────────────────────

/**
 * Render a document body into page bitmaps, delivering each page via a callback
 * as soon as it's painted. `onTotalKnown` fires once after math renders and
 * layout is done — before any `onPage` calls — so callers know the final page
 * count without waiting for all pages to be painted.
 */
export async function streamDocumentPages(
  body: string,
  config: Partial<DocRenderConfig> = {},
  onPage: (bitmap: ImageData, index: number, total: number) => Promise<void>,
  onTotalKnown?: (total: number) => void,
): Promise<void> {
  const cfg = { ...DEFAULT_DOC_CONFIG, ...config }
  const blocks = parseBlocks(body)
  const usableW = cfg.pageW - 2 * cfg.pad
  const usableH = cfg.pageH - 2 * cfg.pad

  // Measuring context (font metrics only; never painted).
  const measure = document.createElement('canvas').getContext('2d')!
  const bodyFont = `${cfg.fontPx}px ${cfg.fontFamily}`
  const headFont = `600 ${cfg.headingPx}px ${cfg.fontFamily}`
  measure.font = bodyFont
  const spaceWidth = measure.measureText(' ').width

  // Rasterize every math fragment up front (parallel), keyed by latex+mode.
  const mathCache = new Map<string, RasterMath | null>()
  const jobs: Array<Promise<void>> = []
  const queueMath = (latex: string, display: boolean) => {
    const key = (display ? 'D:' : 'I:') + latex
    if (mathCache.has(key)) return
    mathCache.set(key, null)
    jobs.push(
      texToImage(latex, {
        display,
        pxPerEx: display ? cfg.displayPxPerEx : cfg.inlinePxPerEx,
        maxW: usableW,
        maxH: display ? usableH : undefined,
      })
        .then(r => void mathCache.set(key, r))
        .catch(() => void mathCache.set(key, null)),
    )
  }
  for (const b of blocks) {
    if (b.kind === 'displaymath') queueMath(b.latex, true)
    else if (b.kind !== 'heading') {
      for (const t of tokenizeInline(b.text)) if (t.type === 'math') queueMath(t.latex, false)
    }
  }
  await Promise.all(jobs)

  // Build boxes for an inline token stream.
  const wordBox = (text: string, font: string, px: number): Box => {
    measure.font = font
    const width = measure.measureText(text).width
    return {
      width,
      ascent: TEXT_ASCENT(px),
      descent: TEXT_DESCENT(px),
      draw(ctx, x, baseline) {
        ctx.font = font
        ctx.fillText(text, x, baseline)
      },
    }
  }
  const mathBox = (latex: string, display: boolean, px: number): Box => {
    const r = mathCache.get((display ? 'D:' : 'I:') + latex) ?? null
    if (!r) return wordBox(`$${latex}$`, `${px}px ${cfg.fontFamily}`, px) // fallback to source
    return {
      width: r.width,
      ascent: r.height - r.depth,
      descent: r.depth,
      draw(ctx, x, baseline) {
        ctx.drawImage(r.img, x, baseline - (r.height - r.depth), r.width, r.height)
      },
    }
  }
  const toBoxes = (tokens: InlineToken[], font: string, px: number): Array<Box | 'glue'> =>
    tokens.map(t =>
      t.type === 'glue' ? 'glue' : t.type === 'word' ? wordBox(t.text, font, px) : mathBox(t.latex, false, px),
    )

  // Flatten the whole document into rows (with inter-block spacers).
  const rows: Row[] = []
  const gap = (h: number) => rows.push({ height: h, spacer: true, draw() {} })
  blocks.forEach((b, idx) => {
    if (idx > 0) gap(cfg.blockGap)
    if (b.kind === 'heading') {
      rows.push(...wrapBoxes(cfg, toBoxes(tokenizeInline(b.text), headFont, cfg.headingPx), headFont, usableW, spaceWidth, 0, 0))
    } else if (b.kind === 'para') {
      rows.push(...wrapBoxes(cfg, toBoxes(tokenizeInline(b.text), bodyFont, cfg.fontPx), bodyFont, usableW, spaceWidth, 0, 0))
    } else if (b.kind === 'listitem') {
      const marker = wordBox(b.marker, bodyFont, cfg.fontPx)
      const indent = marker.width + spaceWidth
      const boxes: Array<Box | 'glue'> = [marker, 'glue', ...toBoxes(tokenizeInline(b.text), bodyFont, cfg.fontPx)]
      rows.push(...wrapBoxes(cfg, boxes, bodyFont, usableW, spaceWidth, 0, indent))
    } else {
      // display math: one centered row (image drawn black-on-white)
      const r = mathCache.get('D:' + b.latex) ?? null
      if (r) {
        const x = Math.round((cfg.pageW - 2 * cfg.pad - r.width) / 2)
        rows.push({
          height: r.height,
          draw(ctx, yTop) {
            ctx.drawImage(r.img, cfg.pad + Math.max(0, x), yTop, r.width, r.height)
          },
        })
      } else {
        rows.push(...wrapBoxes(cfg, [wordBox(`$$${b.latex}$$`, bodyFont, cfg.fontPx)], bodyFont, usableW, spaceWidth, 0, 0))
      }
    }
  })

  // Paginate: pack rows top-to-bottom; a row that overflows starts a new page.
  // Leading spacers at a page top are dropped so pages start flush.
  const pageRows: Row[][] = []
  let cur: Row[] = []
  let y = 0
  for (const row of rows) {
    if (row.spacer && cur.length === 0) continue
    if (cur.length && y + row.height > usableH) {
      pageRows.push(cur)
      cur = []
      y = 0
      if (row.spacer) continue
    }
    cur.push(row)
    y += row.height
  }
  if (cur.length) pageRows.push(cur)
  if (pageRows.length === 0) pageRows.push([]) // always emit at least one (blank) page

  const total = pageRows.length
  onTotalKnown?.(total)

  // Paint each page black-on-white and deliver via callback.
  for (let i = 0; i < total; i++) {
    const canvas = document.createElement('canvas')
    canvas.width = cfg.pageW
    canvas.height = cfg.pageH
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cfg.pageW, cfg.pageH)
    ctx.fillStyle = '#000000'
    let yy = cfg.pad
    for (const row of pageRows[i]) {
      row.draw(ctx, yy)
      yy += row.height
    }
    await onPage(ctx.getImageData(0, 0, cfg.pageW, cfg.pageH), i, total)
  }
}

/** Render an entire document body into full-surface black-on-white page bitmaps. */
export async function renderDocumentPages(
  body: string,
  config: Partial<DocRenderConfig> = {},
): Promise<ImageData[]> {
  const result: ImageData[] = []
  await streamDocumentPages(body, config, async bmp => { result.push(bmp) })
  return result
}

// Re-exported so the page model can encode previews without reaching into index.
export { encodePng }
