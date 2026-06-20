// ─────────────────────────────────────────────────────────────────────────
// On-glasses speed HUD (Iteration 5) — a speed slider drawn INTO the page.
//
// Why composite instead of a separate overlay container: in reading mode the
// surface is fully covered by the 2×2 image tiles (all 4 image containers used),
// and the native status line sits BEHIND them — so a status-text speed flash is
// invisible on-glass. The only pixels the glasses actually show are the tiles, so
// the speed indicator has to be painted onto them.
//
// We draw a slim band across the BOTTOM of the surface (the two bottom tiles,
// slots id 3 & 4), keeping the math above it intact: decode the page's clean
// bottom tiles, draw the band + slider + numeric label over their lower strip,
// re-crop into the two 288×144 tiles, and re-encode. The reader pushes these two
// tiles on a swipe, then restores the clean bottom tiles after a moment — a
// transient "volume bar" so you can see the speed change on the glasses.
//
// Slider geometry mirrors the phone control: left = fast (low sec/page), right =
// slow. The fill position uses a LOG scale so the knob moves meaningfully across
// the wide 2…180 s/page range instead of hugging the fast end.
// ─────────────────────────────────────────────────────────────────────────

import { encodePng } from '../render'
import { SURFACE } from '../glasses/types'
import { MIN_SEC_PER_PAGE, MAX_SEC_PER_PAGE, formatSpeed } from './speed'
import type { Tile } from '../render/slice'

const TILE_H = SURFACE.height / 2 // 144 — the bottom tiles start here
const BAND_H = 60 // height of the HUD band along the bottom

/** The page's clean bottom-row tiles (slots covering the lower half). */
export function bottomTiles(pageTiles: Tile[]): Tile[] {
  return pageTiles.filter(t => t.slot.y >= TILE_H)
}

/**
 * Build the two bottom tiles with a speed slider composited over their lower
 * strip. The math in the upper part of those tiles is preserved.
 */
export async function renderSpeedHudTiles(pageTiles: Tile[], speed: number): Promise<Tile[]> {
  const bottom = bottomTiles(pageTiles)
  if (bottom.length === 0) return []

  // One canvas spanning the full bottom row (576×144); draw clean content first.
  const canvas = makeCanvas(SURFACE.width, TILE_H)
  const ctx = canvas.getContext('2d')!
  for (const tile of bottom) {
    const img = await decodePng(tile.bytes)
    ctx.drawImage(img, tile.slot.x, 0)
  }

  drawSpeedBar(ctx, speed)

  // Re-crop the row back into per-tile regions and encode.
  const out: Tile[] = []
  for (const tile of bottom) {
    const region = ctx.getImageData(tile.slot.x, 0, tile.slot.width, tile.slot.height)
    out.push({ slot: tile.slot, bytes: await encodePng(region) })
  }
  return out
}

/** Fraction 0→1 (fast→slow) on a log scale across the speed range. */
function speedFraction(speed: number): number {
  const lo = Math.log(MIN_SEC_PER_PAGE)
  const hi = Math.log(MAX_SEC_PER_PAGE)
  const f = (Math.log(Math.min(MAX_SEC_PER_PAGE, Math.max(MIN_SEC_PER_PAGE, speed))) - lo) / (hi - lo)
  return Math.max(0, Math.min(1, f))
}

// Pixels map to luminance on the glasses (white = bright green, black = off), so
// solid grays are all we need — no dithering for these flat shapes.
function drawSpeedBar(ctx: CanvasRenderingContext2D, speed: number) {
  const W = SURFACE.width
  const top = TILE_H - BAND_H // 84
  const x0 = 60
  const x1 = W - 60

  // Opaque band + a hairline so its top edge reads against the math above.
  ctx.fillStyle = '#000'
  ctx.fillRect(0, top, W, BAND_H)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, top, W, 1)

  // Numeric label, centered.
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = 'bold 19px system-ui, -apple-system, sans-serif'
  ctx.fillText(`Скорость: ${formatSpeed(speed)}`, W / 2, top + 26)

  // Track (dim), filled portion (bright), knob.
  const trackY = top + 42
  ctx.fillStyle = '#666666'
  ctx.fillRect(x0, trackY - 1, x1 - x0, 3)
  const knobX = x0 + speedFraction(speed) * (x1 - x0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x0, trackY - 1, knobX - x0, 3)
  ctx.beginPath()
  ctx.arc(knobX, trackY, 6, 0, Math.PI * 2)
  ctx.fill()

  // End labels.
  ctx.font = '11px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = '#9a9a9a'
  ctx.textAlign = 'left'
  ctx.fillText('быстро', x0, top + 56)
  ctx.textAlign = 'right'
  ctx.fillText('медленно', x1, top + 56)
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function decodePng(bytes: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('hud: tile decode failed'))
    }
    img.src = url
  })
}
