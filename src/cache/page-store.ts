// ─────────────────────────────────────────────────────────────────────────
// Persistent page-tile cache — survives WebView restarts.
//
// Tile bytes (PNG) are stored as base64 strings in the shared KV backend:
// host-native KV on hardware (bridge to phone's native store), IndexedDB on
// desktop. The phone preview is NOT stored — it's regenerated from tiles via
// createImageBitmap when loading from cache, so there's no redundant image data.
//
// Keys (namespaced by render-version + content-hash so stale entries are
// automatically invisible when RENDER_VERSION bumps):
//   g2reader:pc:<ver>:<hash>:n     → page count (e.g. "105")
//   g2reader:pc:<ver>:<hash>:<i>:0 → base64 of tile[0].bytes for page i
//   g2reader:pc:<ver>:<hash>:<i>:1 → base64 of tile[1].bytes for page i
//
// Size budget: Each dithered 288×144 PNG is roughly 3–10 KB → base64 ~4–14 KB.
// Files with many pages can exceed what NSUserDefaults (host KV on iOS) can
// hold (~1 MB informal limit). We cap at MAX_CACHED_PAGES pages: files larger
// than that skip the KV cache (they still benefit from the in-memory cache and
// progressive streaming). Raise the cap if later benchmarks show the host KV
// handles larger payloads comfortably.
// ─────────────────────────────────────────────────────────────────────────

import type { KVBackend } from '../library/store'
import type { Page } from '../teleprompter/pages'
import { SURFACE, layoutTile1x2 } from '../glasses'
import type { Tile } from '../render/slice'

// Only cache files up to this many pages (keeps total KV payload under ~1 MB).
const MAX_CACHED_PAGES = 60

let backend: KVBackend | null = null

/** Install the KV backend (called from main.ts after the bridge is up). */
export function initPageStore(b: KVBackend): void {
  backend = b
}

// ── Key helpers ──────────────────────────────────────────────────────────────

function metaKey(ver: string, hash: string): string {
  return `g2reader:pc:${ver}:${hash}:n`
}
function tileKey(ver: string, hash: string, pageIdx: number, tileIdx: number): string {
  return `g2reader:pc:${ver}:${hash}:${pageIdx}:${tileIdx}`
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a complete cached document. Returns null on cache miss (any page absent,
 * meta missing, or backend unavailable). Generates previews from tile bytes so
 * no preview data needs to be stored.
 */
export async function loadCachedDoc(
  ver: string,
  hash: string,
  id: string,
  title: string,
): Promise<{ id: string; title: string; pages: Page[] } | null> {
  if (!backend) return null
  try {
    const countStr = await backend.get(metaKey(ver, hash))
    if (!countStr) return null
    const count = parseInt(countStr, 10)
    if (!count || count <= 0 || count > MAX_CACHED_PAGES) return null

    const slots = layoutTile1x2()
    const pages: Page[] = []
    for (let i = 0; i < count; i++) {
      const tiles: Tile[] = []
      for (let t = 0; t < slots.length; t++) {
        const b64 = await backend.get(tileKey(ver, hash, i, t))
        if (!b64) return null // incomplete cache — treat as miss
        tiles.push({ slot: slots[t], bytes: b64ToBytes(b64) })
      }
      const preview = await previewFromTiles(tiles)
      pages.push({ tiles, preview })
    }
    return { id, title, pages }
  } catch {
    return null
  }
}

/**
 * Persist one rendered page to the KV store (fire-and-forget).
 * When `pageIdx` equals `total - 1` the metadata key is written last, which
 * acts as an atomic commit marker — a partial write (app killed mid-save) is
 * treated as a cache miss on the next load.
 * Silently skips files larger than MAX_CACHED_PAGES.
 */
export function cacheDocPage(
  ver: string,
  hash: string,
  pageIdx: number,
  total: number,
  page: Page,
): void {
  if (!backend || total > MAX_CACHED_PAGES) return
  void (async () => {
    try {
      for (let t = 0; t < page.tiles.length; t++) {
        await backend!.set(tileKey(ver, hash, pageIdx, t), bytesToB64(page.tiles[t].bytes))
      }
      if (pageIdx === total - 1) {
        // Write count last — completing this key marks the cache as valid.
        await backend!.set(metaKey(ver, hash), String(total))
      }
    } catch {
      // Best-effort: if the host KV is full or fails, silently skip.
    }
  })()
}

// ── Codec helpers ────────────────────────────────────────────────────────────

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── Preview reconstruction ───────────────────────────────────────────────────

/**
 * Regenerate the green phone preview from the dithered tile PNG bytes.
 * Decodes each tile via createImageBitmap, applies the green tint (same
 * transform as slice.ts greenPreview), and composites onto the full 576×288
 * surface so the phone mirrors the true on-glass layout.
 */
async function previewFromTiles(tiles: Tile[]): Promise<string> {
  const W = SURFACE.width
  const H = SURFACE.height
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, H)

  for (const tile of tiles) {
    const blob = new Blob([tile.bytes.buffer as ArrayBuffer], { type: 'image/png' })
    const bmp = await createImageBitmap(blob)

    // Decode to a temp canvas, apply green tint, composite onto the surface.
    const tc = document.createElement('canvas')
    tc.width = tile.slot.width
    tc.height = tile.slot.height
    const tCtx = tc.getContext('2d')!
    tCtx.drawImage(bmp, 0, 0)
    bmp.close()

    const id = tCtx.getImageData(0, 0, tile.slot.width, tile.slot.height)
    const od = new ImageData(id.width, id.height)
    for (let p = 0; p < id.data.length; p += 4) {
      const lum = id.data[p] // grayscale: r=g=b after dither
      od.data[p] = Math.round(lum * 0.15)
      od.data[p + 1] = lum
      od.data[p + 2] = Math.round(lum * 0.35)
      od.data[p + 3] = 255
    }
    const oc = document.createElement('canvas')
    oc.width = id.width
    oc.height = id.height
    oc.getContext('2d')!.putImageData(od, 0, 0)
    ctx.drawImage(oc, tile.slot.x, tile.slot.y)
  }

  return canvas.toDataURL('image/png')
}
