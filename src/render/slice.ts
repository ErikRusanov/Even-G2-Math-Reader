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
import { layoutTile2x2, type ImageSlot } from '../glasses'

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
  // One dither pass over the whole surface → white-on-black, 16-level grayscale.
  const dithered = ditherTo4bit(blackOnWhite, true)

  const big = makeCanvas(dithered.width, dithered.height)
  const bigCtx = big.getContext('2d')!
  bigCtx.putImageData(dithered, 0, 0)

  const slots = layoutTile2x2()
  const tiles: Tile[] = []
  for (const slot of slots) {
    const region = bigCtx.getImageData(slot.x, slot.y, slot.width, slot.height)
    const bytes = await encodePng(region)
    tiles.push({ slot, bytes })
  }

  return { tiles, preview: greenPreview(dithered) }
}

/** White-on-black grayscale → bright-green-on-dark PNG data URL (phone mirror). */
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
  const c = makeCanvas(width, height)
  c.getContext('2d')!.putImageData(out, 0, 0)
  return c.toDataURL('image/png')
}
