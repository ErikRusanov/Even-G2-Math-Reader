// ─────────────────────────────────────────────────────────────────────────
// Render pipeline: LaTeX → encoded PNG bytes ready for the glasses adapter.
//
//   texToSvg()        LaTeX → self-contained SVG (paths)        [mathjax.ts]
//        ▼
//   rasterizeSvg()    SVG → black-on-white RGBA at target px     [here]
//        ▼
//   ditherTo4bit()    → white-on-black, 16-level FS-dithered      [dither.ts]
//        ▼
//   encodePng()       ImageData → PNG Uint8Array                  [here]
//
// CALIBRATION KNOB: `pxPerEx` sets glyph scale (pixels per math ex). Iteration 1
// eyes-on-glass calibration picked pxPerEx = 8 as the ideal: every sample (frac
// bar, Σ, √, the a^{(k-1)}_{k,k} sub/superscript stack) reads cleanly and it's
// tighter than the `formula-small` target — the reference series formula →
// ~145×51 px, leaving generous vertical room for scrolling (Iteration 3). Below
// ~6 the sub/superscript tier starts to blur; main.ts sweeps {6,7,8,9,10}.
// Output is ALWAYS clamped to one image container (≤288×144) and the returned
// width/height MUST be used verbatim as the container size, so the host neither
// resizes nor re-dithers our result. (Multi-container tiling/slicing is later.)
// ─────────────────────────────────────────────────────────────────────────

import { texToSvg } from './mathjax'
import { ditherTo4bit } from './dither'
import { IMAGE_LIMITS } from '../glasses/types'

export interface RenderOptions {
  /** Pixels per math `ex` — the glyph-scale calibration knob. */
  pxPerEx?: number
  /** Display (block) vs inline math metrics. */
  display?: boolean
  /** Max output width/height (defaults to one image container, 288×144). */
  maxW?: number
  maxH?: number
}

export interface RenderedImage {
  /** Encoded PNG bytes — feed straight to `GlassesAdapter.sendImage`. */
  bytes: Uint8Array
  /** Final pixel size. Use as the image-slot size so the host never resizes. */
  width: number
  height: number
}

const DEFAULTS = { pxPerEx: 8, display: true } as const

/** LaTeX → dithered PNG bytes, sized to fit a single image container. */
export async function renderFormula(latex: string, opts: RenderOptions = {}): Promise<RenderedImage> {
  const pxPerEx = opts.pxPerEx ?? DEFAULTS.pxPerEx
  const display = opts.display ?? DEFAULTS.display
  const maxW = opts.maxW ?? IMAGE_LIMITS.maxW
  const maxH = opts.maxH ?? IMAGE_LIMITS.maxH

  const { svg, exWidth, exHeight } = texToSvg(latex, display)

  // Nominal pixel size from the calibration scale, then fit into one container
  // while preserving aspect ratio. Vector SVG downscales crisply, so pxPerEx is
  // a nominal target, not a hard cap.
  let w = exWidth * pxPerEx
  let h = exHeight * pxPerEx
  const fit = Math.min(maxW / w, maxH / h, 1)
  w = Math.round(w * fit)
  h = Math.round(h * fit)
  // Respect the container minimum (20px) without breaking aspect.
  const up = Math.max(IMAGE_LIMITS.minW / w, IMAGE_LIMITS.minH / h, 1)
  w = Math.min(maxW, Math.round(w * up))
  h = Math.min(maxH, Math.round(h * up))

  const rgba = await rasterizeSvg(svg, w, h)
  const dithered = ditherTo4bit(rgba, true)
  const bytes = await encodePng(dithered)
  return { bytes, width: w, height: h }
}

// ── DOM rasterization helpers (browser/WebView only) ────────────────────────

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Draw a self-contained SVG onto a white canvas at w×h and read back RGBA. */
function rasterizeSvg(svg: string, w: number, h: number): Promise<ImageData> {
  // Force explicit pixel dimensions on the root so the <img> rasterizes at our
  // exact target size; the viewBox keeps the vector content scaled correctly.
  const sized = svg
    .replace(/width="[\d.]+ex"/, `width="${w}"`)
    .replace(/height="[\d.]+ex"/, `height="${h}"`)
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized)

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = makeCanvas(w, h)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(ctx.getImageData(0, 0, w, h))
    }
    img.onerror = () => reject(new Error('SVG rasterization failed'))
    img.src = url
  })
}

/** ImageData → encoded PNG bytes. */
async function encodePng(image: ImageData): Promise<Uint8Array> {
  const canvas = makeCanvas(image.width, image.height)
  canvas.getContext('2d')!.putImageData(image, 0, 0)
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png'),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

export { texToSvg, texToInlineSvg } from './mathjax'
export { ditherTo4bit } from './dither'
