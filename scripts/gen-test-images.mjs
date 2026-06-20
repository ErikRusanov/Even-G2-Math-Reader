// Dev-only generator for the Iteration-0 hardware spike.
//
// Produces three kinds of static probe images — by hand, NOT through the
// KaTeX→4-bit pipeline (that's Iteration 1). The point is to put *something*
// real on the glass and answer the open hardware questions before any pipeline
// code exists:
//
//   formula-large.png    one formula, large   → is dense math legible at 4-bit?
//   formula-small.png    same formula, small  → how small can sub/superscripts go?
//   checker-tile-{1..4}.png  four 288×144 quadrants of one 576×288 checkerboard
//                        → can 4 image slots tile the FULL surface to its edges?
//   checker-576x288.png  desktop-only reference of the full checkerboard
//
// We draw light strokes on black: the panel is green-on-black, so brighter =
// more visible, and thin strokes (fraction bars, Σ, Greek) survive 4-bit best
// when they're the bright ink. Output is encoded PNG — the SDK does the
// grayscale/dither conversion on the host.

import { createCanvas } from '@napi-rs/canvas'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'test')

const INK = '#ffffff'
const BG = '#000000'

// Draw a representative dense expression centered in the canvas, scaled to the
// canvas size. Exercises a fraction bar, a Σ with limits, sub/superscripts and
// a Greek letter — the glyphs most at risk at 4-bit.
function drawFormula(ctx, w, h) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = INK

  const base = Math.round(h * 0.34) // base font size scales with canvas height
  const small = Math.round(base * 0.6)
  const serif = (px) => `${px}px "Times New Roman", Georgia, serif`
  ctx.textBaseline = 'middle'
  const cy = Math.round(h * 0.5)
  let x = Math.round(w * 0.06)

  // "f(x) = "
  ctx.font = serif(base)
  ctx.textAlign = 'left'
  const lhs = 'f(x) = '
  ctx.fillText(lhs, x, cy)
  x += ctx.measureText(lhs).width

  // Σ with limits (n above, i=1 below)
  ctx.font = serif(Math.round(base * 1.25))
  const sig = 'Σ'
  const sigW = ctx.measureText(sig).width
  ctx.fillText(sig, x, cy)
  ctx.font = serif(Math.round(small * 0.8))
  ctx.textAlign = 'center'
  ctx.fillText('n', x + sigW / 2, cy - base * 0.7)
  ctx.fillText('i=1', x + sigW / 2, cy + base * 0.7)
  ctx.textAlign = 'left'
  x += sigW + Math.round(w * 0.02)

  // fraction: (aᵢ xⁱ) / (1 − x²) with a visible bar. Super/subscripts are
  // drawn by hand (raised/lowered small glyphs) so we don't depend on unicode
  // sub/superscript codepoints existing in the font.
  ctx.font = serif(small)
  const numTop = cy - small * 0.75
  const denBot = cy + small * 0.75
  const fracX = x + 6
  const sub = Math.round(small * 0.62)
  const drift = small * 0.28

  // measure the numerator "a x" + sub i + super i to center it
  const measure = (txt, px) => {
    ctx.font = serif(px)
    return ctx.measureText(txt).width
  }
  const numW =
    measure('a', small) + measure('i', sub) + measure(' x', small) + measure('i', sub)
  const den = '1 − x²'
  const denW = measure(den, small)
  const barW = Math.max(numW, denW) + 12

  // numerator, token by token
  let nx = fracX + (barW - numW) / 2
  ctx.font = serif(small)
  ctx.fillText('a', nx, numTop)
  nx += measure('a', small)
  ctx.font = serif(sub)
  ctx.fillText('i', nx, numTop + drift) // subscript i on a
  nx += measure('i', sub)
  ctx.font = serif(small)
  ctx.fillText(' x', nx, numTop)
  nx += measure(' x', small)
  ctx.font = serif(sub)
  ctx.fillText('i', nx, numTop - drift) // superscript i on x

  // denominator
  ctx.font = serif(small)
  ctx.fillText(den, fracX + (barW - denW) / 2, denBot)
  // fraction bar — a thin horizontal stroke, the classic 4-bit casualty
  ctx.fillStyle = INK
  ctx.fillRect(fracX, cy, barW, Math.max(1, Math.round(h * 0.012)))
}

async function writeFormula(name, w, h) {
  const canvas = createCanvas(w, h)
  drawFormula(canvas.getContext('2d'), w, h)
  await writeFile(join(OUT_DIR, name), canvas.toBuffer('image/png'))
  console.log(`  ${name}  (${w}×${h})`)
}

// One global checkerboard over 576×288, sliced into 288×144 quadrants. A 2px
// frame is drawn on the true outer edges so you can see on-glass whether image
// content reaches the physical surface border.
const FULL_W = 576
const FULL_H = 288
const CELL = 24

function drawCheckerRegion(ctx, originX, originY, w, h) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = INK
  for (let py = 0; py < h; py++) {
    const gy = originY + py
    for (let px = 0; px < w; px++) {
      const gx = originX + px
      const on = (Math.floor(gx / CELL) + Math.floor(gy / CELL)) % 2 === 0
      if (on) ctx.fillRect(px, py, 1, 1)
    }
  }
  // outer frame on true surface edges only
  ctx.fillStyle = INK
  const t = 2
  if (originX === 0) ctx.fillRect(0, 0, t, h)
  if (originY === 0) ctx.fillRect(0, 0, w, t)
  if (originX + w === FULL_W) ctx.fillRect(w - t, 0, t, h)
  if (originY + h === FULL_H) ctx.fillRect(0, h - t, w, t)
}

async function writeCheckerTiles() {
  const tw = FULL_W / 2 // 288
  const th = FULL_H / 2 // 144
  const tiles = [
    [1, 0, 0],
    [2, tw, 0],
    [3, 0, th],
    [4, tw, th],
  ]
  for (const [id, ox, oy] of tiles) {
    const canvas = createCanvas(tw, th)
    drawCheckerRegion(canvas.getContext('2d'), ox, oy, tw, th)
    const name = `checker-tile-${id}.png`
    await writeFile(join(OUT_DIR, name), canvas.toBuffer('image/png'))
    console.log(`  ${name}  (${tw}×${th}) @ (${ox},${oy})`)
  }
  // full-surface reference (desktop inspection only; not pushed as one image)
  const full = createCanvas(FULL_W, FULL_H)
  drawCheckerRegion(full.getContext('2d'), 0, 0, FULL_W, FULL_H)
  await writeFile(join(OUT_DIR, 'checker-576x288.png'), full.toBuffer('image/png'))
  console.log(`  checker-576x288.png  (${FULL_W}×${FULL_H})  [reference]`)
}

await mkdir(OUT_DIR, { recursive: true })
console.log('Generating spike test images →', OUT_DIR)
await writeFormula('formula-large.png', 288, 144)
await writeFormula('formula-small.png', 220, 80)
await writeCheckerTiles()
console.log('Done.')
