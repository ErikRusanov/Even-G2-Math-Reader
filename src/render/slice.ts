// ─────────────────────────────────────────────────────────────────────────
// Page slicing — a full-surface page bitmap → 4 image-container tiles.
//
// A page is the true glasses surface (576×288), but a single image container is
// capped at 288×144, so the full surface needs four 288×144 tiles in a 2×2 grid
// (see glasses/layoutTile2x2). The host warned that repainting all 4 tiles is
// slow over BLE — fine for Iteration 3's MANUAL paging (a flip is infrequent),
// to be revisited for autoscroll (Iteration 4).
//
// Order matters: we dither the WHOLE 576×288 page ONCE (so Floyd–Steinberg error
// diffuses across the entire surface with no seams at tile borders), THEN crop
// the already-quantized result into quadrants — cropping a quantized image is
// lossless. We also emit a green phone-preview data URL so the phone mirrors what
// the glasses show (this is the REAL 4-bit output, unlike Iteration 2's sharp SVG
// preview).
// ─────────────────────────────────────────────────────────────────────────

import { ditherTo4bit, encodePng } from './index'
import { layoutTile2x2, layoutTile1x2, SURFACE, type ImageSlot } from '../glasses'

// How bright the rendered "ink" is, 0..1 (1 = full-bright white glyphs). The
// glasses panel was too harsh at full white, so we render the ink a notch dimmer
// and let the phone-set display brightness govern the absolute level. 0.7 maps
// the brightest glyph pixels to ~level 11/15 — legible but not glaring. Tune
// eyes-on-glass; bump RENDER_VERSION (pages.ts) when you change it so the page
// cache is rebuilt.
const INK_SCALE = 0.7

export interface Tile {
  slot: ImageSlot
  /** Encoded PNG bytes — feed straight to GlassesAdapter.sendImage(slot.id, …). */
  bytes: Uint8Array
}

export interface SlicedPage {
  /** Four 288×144 tiles covering the 576×288 surface. */
  tiles: Tile[]
  /** Green-tinted PNG data URL of the whole page, for the phone preview. */
  preview: string
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Dither a full-surface black-on-white page, then tile + build a phone preview. */
export async function slicePage(blackOnWhite: ImageData): Promise<SlicedPage> {
  // One dither pass over the whole surface → white-on-black, 16-level grayscale,
  // dimmed to INK_SCALE so the panel isn't glaring at full white.
  const dithered = ditherTo4bit(blackOnWhite, true, INK_SCALE)

  const big = makeCanvas(dithered.width, dithered.height)
  const bigCtx = big.getContext('2d')!
  bigCtx.putImageData(dithered, 0, 0)

  // A half-height page (≤144) is the 2-tile reading layout (top row); a
  // full-surface page is the 2×2. Slots are surface-positioned at y=0 for the top
  // row, so they index straight into the page bitmap.
  const slots = dithered.height <= SURFACE.height / 2 ? layoutTile1x2() : layoutTile2x2()
  const tiles: Tile[] = []
  for (const slot of slots) {
    const region = bigCtx.getImageData(slot.x, slot.y, slot.width, slot.height)
    const bytes = await encodePng(region)
    tiles.push({ slot, bytes })
  }

  return { tiles, preview: greenPreview(dithered) }
}

/**
 * White-on-black grayscale → bright-green-on-dark PNG data URL (phone mirror).
 * Always sized to the full 576×288 surface with the page placed at the TOP, so
 * the phone shows the true on-glass layout — for a half-height (2-tile) page the
 * bottom half is blank, exactly as on the glasses.
 */
function greenPreview(dithered: ImageData): string {
  const { width, height, data } = dithered
  const out = new ImageData(width, height)
  const od = out.data
  for (let p = 0; p < data.length; p += 4) {
    const lum = data[p] // grayscale: r=g=b
    od[p] = Math.round(lum * 0.15) // a hint of red keeps bright pixels from looking neon
    od[p + 1] = lum
    od[p + 2] = Math.round(lum * 0.35)
    od[p + 3] = 255
  }
  const tmp = makeCanvas(width, height)
  tmp.getContext('2d')!.putImageData(out, 0, 0)

  const c = makeCanvas(SURFACE.width, SURFACE.height)
  const cx = c.getContext('2d')!
  cx.fillStyle = '#000000'
  cx.fillRect(0, 0, SURFACE.width, SURFACE.height)
  cx.drawImage(tmp, 0, 0) // page at top; remainder stays black
  return c.toDataURL('image/png')
}
