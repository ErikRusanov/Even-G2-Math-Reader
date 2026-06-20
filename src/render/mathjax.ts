// ─────────────────────────────────────────────────────────────────────────
// TeX → SVG, via MathJax v3 (mathjax-full + liteAdaptor).
//
// Why MathJax SVG (not KaTeX HTML): the render pipeline needs pixel access
// (getImageData for dithering) and PNG export (toBlob). Both throw on a
// *tainted* canvas. KaTeX emits HTML, which can only be rasterized via the SVG
// <foreignObject> trick — and that taints the canvas on WebKit/WKWebView,
// breaking export entirely. MathJax emits SVG with glyphs as <path> elements
// (no foreignObject, no font files to load): it draws to a canvas cleanly and
// NEVER taints, on Android Chromium and iOS WebKit alike. Decision logged in
// docs/02 (this iteration switched the planned engine from KaTeX → MathJax).
//
// `fontCache: 'local'` inlines the glyph paths into each SVG's own <defs>, so
// every returned SVG is fully self-contained — safe to drop into a data: URI.
// ─────────────────────────────────────────────────────────────────────────

import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'
import type { LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import type { MathDocument } from 'mathjax-full/js/core/MathDocument.js'

export interface TexSvg {
  /** Self-contained SVG markup (glyphs inlined as paths). */
  svg: string
  /** Intrinsic width in `ex` units (1 ex ≈ the math font's x-height). */
  exWidth: number
  /** Intrinsic height in `ex` units. */
  exHeight: number
}

// MathJax's handler registration is global, so build the document once and
// reuse it for every conversion.
let adaptor: LiteAdaptor | null = null
let doc: MathDocument<unknown, unknown, unknown> | null = null

function ensureDoc() {
  if (doc && adaptor) return { doc, adaptor }
  adaptor = liteAdaptor()
  RegisterHTMLHandler(adaptor)
  const tex = new TeX({ packages: AllPackages })
  const svg = new SVG({ fontCache: 'local' })
  doc = mathjax.document('', { InputJax: tex, OutputJax: svg })
  return { doc, adaptor }
}

function parseEx(svg: string, attr: 'width' | 'height'): number {
  const m = svg.match(new RegExp(`${attr}="([\\d.]+)ex"`))
  return m ? parseFloat(m[1]) : 0
}

/** Convert a LaTeX string to a self-contained SVG plus its intrinsic ex size. */
export function texToSvg(latex: string, display = true): TexSvg {
  const { doc, adaptor } = ensureDoc()
  // doc.convert returns the document's generic node type; the liteAdaptor only
  // ever produces LiteElements, so this cast is safe.
  const node = doc.convert(latex, { display }) as Parameters<LiteAdaptor['innerHTML']>[0]
  const svg = adaptor.innerHTML(node)
  return { svg, exWidth: parseEx(svg, 'width'), exHeight: parseEx(svg, 'height') }
}
