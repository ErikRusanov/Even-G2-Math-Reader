// ─────────────────────────────────────────────────────────────────────────
// Page model — a library file → a paged, glasses-ready document.
//
// Ties the render pipeline together for one file:
//   renderDocumentPages()  body → full-surface black-on-white page bitmaps
//   slicePage()            each page → 4 dithered tiles + a green phone preview
//   memoize()              cache the whole result by content hash
//
// The result is a flat list of Pages; the reader's autoscroll engine (Iteration 4)
// auto-advances through this same list on a timer.
// ─────────────────────────────────────────────────────────────────────────

import { renderDocumentPages } from '../render/document'
import { slicePage, type Tile } from '../render/slice'
import { memoize, hashContent } from '../cache'
import { SURFACE } from '../glasses/types'
import type { LibraryEntry } from '../library/load'

/** Bump when the render pipeline changes so stale cached bitmaps are ignored. */
const RENDER_VERSION = 'iter7-dim-ink-v1'

// Reading pages are the TOP HALF of the surface (576×144 → 2 image tiles). Each
// glasses image push is a fixed ~3 s (measured), so halving tiles/page ≈ halves
// load time; the cost is a shorter window (more, faster page flips). Slightly
// tighter padding reclaims a little of the lost vertical room.
const READING_PAGE_H = SURFACE.height / 2 // 144
const READING_PAD = 10

export interface Page {
  /** Four 288×144 tiles to push to the glasses for this page. */
  tiles: Tile[]
  /** Green-tinted data URL mirroring the page on the phone. */
  preview: string
}

export interface PagedDoc {
  id: string
  title: string
  pages: Page[]
}

/** Render (or fetch from cache) a file as flippable, glasses-ready pages. */
export function paginateDocument(
  entry: LibraryEntry,
  onProgress?: (done: number, total: number) => void,
): Promise<PagedDoc> {
  const key = `${RENDER_VERSION}:${entry.id}:${hashContent(entry.body)}`
  return memoize(key, async () => {
    const bitmaps = await renderDocumentPages(entry.body, { pageH: READING_PAGE_H, pad: READING_PAD })
    const pages: Page[] = []
    onProgress?.(0, bitmaps.length)
    for (let i = 0; i < bitmaps.length; i++) {
      pages.push(await slicePage(bitmaps[i]))
      onProgress?.(i + 1, bitmaps.length)
    }
    return { id: entry.id, title: entry.title, pages }
  })
}
