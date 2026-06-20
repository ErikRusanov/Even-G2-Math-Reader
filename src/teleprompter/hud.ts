// ─────────────────────────────────────────────────────────────────────────
// On-glasses speed HUD (Iteration 5) — a floating modal window drawn over ONE
// bottom tile.
//
// ROOT CAUSE this is shaped around (researched, 2026-06-20): pushing an image to
// the glasses is slow because of BLE, and the cost scales with the container's
// PIXEL AREA + a fixed per-push round-trip — NOT with our PNG byte size (the phone
// host re-encodes each container to a fixed bitmap before the BLE hop, so a clever
// small PNG buys nothing). Measured rates from the field: a 50×50 image ≈ 4 FPS
// (~250 ms), 30×30 ≈ 9 FPS (~107 ms), a full 576×136 ≈ 3 s. So a 288×144 tile
// ≈ 1.5 s and the old HUD — which repainted BOTH bottom tiles serially — took
// ~3 s and visibly tore (left tile reverted before the right one landed).
//
// Two levers, both used here: (1) fewer pixels, (2) fewer pushes. We can't add a
// 5th, smaller image container — the 2×2 page already uses all 4 (SDK cap), and a
// full-width page taller than 144 px mathematically needs 4 containers, so there's
// no slot to spare. What we CAN do is touch just ONE of the existing tiles: the
// modal is drawn into a single bottom tile, pushed atomically (no tear) at half
// the cost. The caller coalesces bursts so swipes don't queue.
//
// Slider geometry mirrors the phone control: left = fast (low sec/page), right =
// slow, on a LOG scale so the knob moves meaningfully across the wide 2…180 range.
// ─────────────────────────────────────────────────────────────────────────

import { encodePng } from '../render'
import { SURFACE } from '../glasses/types'
import { MIN_SEC_PER_PAGE, MAX_SEC_PER_PAGE, formatSpeed } from './speed'
import type { Tile } from '../render/slice'

const TILE_W = SURFACE.width / 2 // 288
const TILE_H = SURFACE.height / 2 // 144 — one tile is 288×144

// The single tile we repaint for the HUD: the lowest, left-most one (bottom-left
// on a 2×2 page, top-left on a 2-tile reading page). Reusing exactly one tile
// makes the update atomic — no left/right tear — and is one push, not two.
export function hudTile(pageTiles: Tile[]): Tile | null {
  if (pageTiles.length === 0) return null
  return pageTiles.reduce((best, t) => {
    if (t.slot.y > best.slot.y) return t
    if (t.slot.y === best.slot.y && t.slot.x < best.slot.x) return t
    return best
  })
}

/** The clean (page-only) HUD tile, for restoring after the modal times out. */
export function hudCleanTiles(pageTiles: Tile[]): Tile[] {
  const t = hudTile(pageTiles)
  return t ? [t] : []
}

// Modal window geometry, in the HUD tile's own 288×144 coordinates.
const MODAL_W = 260
const MODAL_H = 104
const MODAL_X = (TILE_W - MODAL_W) / 2 // 14
const MODAL_Y = (TILE_H - MODAL_H) / 2 // 20

/**
 * Build the single HUD tile with a speed modal composited over it. The page
 * content is kept behind the window (it's free — transfer time is fixed by the
 * tile's pixel area regardless of what's drawn), so only a compact box is added.
 */
export async function renderSpeedHudTiles(pageTiles: Tile[], speed: number): Promise<Tile[]> {
  const tile = hudTile(pageTiles)
  if (!tile) return []

  const canvas = makeCanvas(tile.slot.width, tile.slot.height)
  const ctx = canvas.getContext('2d')!
  const img = await decodePng(tile.bytes)
  ctx.drawImage(img, 0, 0)

  drawSpeedModal(ctx, speed)

  const region = ctx.getImageData(0, 0, tile.slot.width, tile.slot.height)
  return [{ slot: tile.slot, bytes: await encodePng(region) }]
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
function drawSpeedModal(ctx: CanvasRenderingContext2D, speed: number) {
  const x = MODAL_X
  const y = MODAL_Y
  const w = MODAL_W
  const h = MODAL_H

  // Window: opaque black panel with a bright 2px border — reads as floating over
  // the math behind it. (Squared corners; the 4-bit panel doesn't resolve radii.)
  ctx.fillStyle = '#000000'
  ctx.fillRect(x, y, w, h)
  ctx.lineWidth = 2
  ctx.strokeStyle = '#ffffff'
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)

  // Title + value, centered near the top of the window.
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = 'bold 18px system-ui, -apple-system, sans-serif'
  ctx.fillText(`Скорость: ${formatSpeed(speed)}`, x + w / 2, y + 34)

  // Track (dim), filled portion (bright), knob — log-scaled across the range.
  const m = 24 // inner side margin
  const x0 = x + m
  const x1 = x + w - m
  const trackY = y + 60
  ctx.fillStyle = '#666666'
  ctx.fillRect(x0, trackY - 1, x1 - x0, 3)
  const knobX = x0 + speedFraction(speed) * (x1 - x0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x0, trackY - 1, knobX - x0, 3)
  ctx.beginPath()
  ctx.arc(knobX, trackY, 6, 0, Math.PI * 2)
  ctx.fill()

  // End labels (left = fast, mirroring the phone slider).
  ctx.font = '11px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = '#9a9a9a'
  ctx.textAlign = 'left'
  ctx.fillText('быстро', x0, y + 86)
  ctx.textAlign = 'right'
  ctx.fillText('медленно', x1, y + 86)
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
