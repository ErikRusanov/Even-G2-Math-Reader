// ─────────────────────────────────────────────────────────────────────────
// Page model — a library file → a streaming, glasses-ready document.
//
// openDocument() is the main entry point. It returns a LiveDoc immediately;
// pages become available asynchronously in order (0, 1, 2, …). The reader
// can start as soon as page 0 is ready via `liveDoc.waitForPage(0)` — it
// does not need to wait for all pages.
//
// Three-layer cache (checked in order, fastest to slowest):
//   L1  In-memory Map (same session, re-opening a file is instant)
//   L2  Host KV / IndexedDB (cross-session, survives WebView restart)
//   L3  Full render: streamDocumentPages → slicePage (seconds on first open)
//
// After a full render, each page is saved to L2 (fire-and-forget) so the
// NEXT open loads from L2 instead of re-rendering. Files >MAX_CACHED_PAGES
// skip L2 but still benefit from L1 and from the progressive streaming (the
// reader starts once page 0 is ready, so the user isn't blocked on 105 pages).
// ─────────────────────────────────────────────────────────────────────────

import { streamDocumentPages } from '../render/document'
import { slicePage, type Tile } from '../render/slice'
import { hashContent } from '../cache'
import { SURFACE } from '../glasses/types'
import { loadCachedDoc, cacheDocPage } from '../cache/page-store'
import type { LibraryEntry } from '../library/load'

/** Bump when the render pipeline changes so stale cached bitmaps are ignored. */
export const RENDER_VERSION = 'iter7-dim-ink-v1'

// Reading pages are the TOP HALF of the surface (576×144 → 2 image tiles). Each
// glasses image push is a fixed ~3 s (measured), so halving tiles/page ≈ halves
// load time; the cost is a shorter window (more, faster page flips). Slightly
// tighter padding reclaims a little of the lost vertical room.
const READING_PAGE_H = SURFACE.height / 2 // 144
const READING_PAD = 10

export interface Page {
  /** Two 288×144 tiles to push to the glasses for this page. */
  tiles: Tile[]
  /** Green-tinted data URL mirroring the page on the phone. */
  preview: string
}

/**
 * A streaming document handle. Pages become available one by one; callers use
 * `waitForPage(i)` to get a page that may not be rendered yet. The reader
 * should start once `waitForPage(0)` resolves — it need not wait for all pages.
 */
export interface LiveDoc {
  readonly id: string
  readonly title: string
  /** Total page count. Set once known (after math renders + layout), 0 before. */
  readonly totalPages: number
  /** True once all pages are rendered and in the page list. */
  readonly isComplete: boolean
  /** Resolves when all pages are ready. Rejects on render error. */
  readonly complete: Promise<void>
  /** Get page `index`, waiting until it is rendered if necessary. */
  waitForPage(index: number): Promise<Page>
}

// ── LiveDoc implementation ───────────────────────────────────────────────────

class LiveDocImpl implements LiveDoc {
  readonly id: string
  readonly title: string
  totalPages = 0
  isComplete = false
  complete: Promise<void>

  private readonly pages: (Page | undefined)[] = []
  private readonly waiters = new Map<number, Array<(p: Page) => void>>()
  private _error: Error | null = null
  private _reject!: (err: Error) => void
  private readonly _resolve: () => void

  constructor(id: string, title: string) {
    this.id = id
    this.title = title
    let res!: () => void
    let rej!: (err: Error) => void
    this.complete = new Promise<void>((r, e) => { res = r; rej = e })
    this._resolve = res
    this._reject = rej
  }

  setTotalPages(n: number): void {
    this.totalPages = n
    // Pre-size the page array so index accesses are defined.
    for (let i = this.pages.length; i < n; i++) this.pages.push(undefined)
  }

  setPage(index: number, page: Page): void {
    this.pages[index] = page
    const ws = this.waiters.get(index)
    if (ws) {
      for (const resolve of ws) resolve(page)
      this.waiters.delete(index)
    }
  }

  markComplete(): void {
    this.isComplete = true
    this._resolve()
  }

  markFailed(err: Error): void {
    this._error = err
    // Rejecting `complete` cascades to all pending waitForPage() promises
    // because each one does `this.complete.catch(reject)`.
    this._reject(err)
  }

  waitForPage(index: number): Promise<Page> {
    if (this._error) return Promise.reject(this._error)
    const p = this.pages[index]
    if (p !== undefined) return Promise.resolve(p)
    return new Promise<Page>((resolve, reject) => {
      // Also reject if the doc later fails.
      this.complete.catch(reject)
      const ws = this.waiters.get(index) ?? []
      ws.push(resolve)
      this.waiters.set(index, ws)
    })
  }
}

// ── In-memory (L1) cache ─────────────────────────────────────────────────────

// Keyed by `${RENDER_VERSION}:${id}:${contentHash}` so stale entries after a
// version bump are naturally evicted (new key → new doc).
const memCache = new Map<string, LiveDocImpl>()

// ── openDocument ─────────────────────────────────────────────────────────────

export interface OpenDocCallbacks {
  /** Called once the total page count is known (after math renders + layout). */
  onTotalKnown?: (total: number) => void
  /** Called each time a page becomes available (index 0, 1, 2, …). */
  onPageReady?: (index: number) => void
  /** Called as pages are sliced: (done, total). Fires after onTotalKnown. */
  onProgress?: (done: number, total: number) => void
}

/**
 * Open a file as a streaming LiveDoc. Returns immediately; pages accumulate
 * asynchronously. Use `liveDoc.waitForPage(0)` to start reading once the
 * first page is ready — typically 2–5 s on the first open (math rendering),
 * <100 ms on subsequent opens if the file was cached.
 */
export function openDocument(entry: LibraryEntry, callbacks: OpenDocCallbacks = {}): LiveDoc {
  const hash = hashContent(entry.body)
  const cacheKey = `${RENDER_VERSION}:${entry.id}:${hash}`

  // L1: in-memory cache (same session — re-opening is instant).
  const existing = memCache.get(cacheKey)
  if (existing) {
    // Fire callbacks for already-available pages (next microtask so the caller
    // can capture the returned LiveDoc before callbacks fire).
    void Promise.resolve().then(() => {
      if (existing.totalPages > 0) {
        callbacks.onTotalKnown?.(existing.totalPages)
        const ready = existing.isComplete ? existing.totalPages : 0
        for (let i = 0; i < ready; i++) {
          callbacks.onPageReady?.(i)
          callbacks.onProgress?.(i + 1, existing.totalPages)
        }
      }
    })
    return existing
  }

  const impl = new LiveDocImpl(entry.id, entry.title)
  memCache.set(cacheKey, impl)

  void (async () => {
    try {
      // L2: persistent cache (host KV / IDB — survives WebView restarts).
      const cached = await loadCachedDoc(RENDER_VERSION, hash, entry.id, entry.title)
      if (cached) {
        impl.setTotalPages(cached.pages.length)
        callbacks.onTotalKnown?.(cached.pages.length)
        for (let i = 0; i < cached.pages.length; i++) {
          impl.setPage(i, cached.pages[i])
          callbacks.onPageReady?.(i)
          callbacks.onProgress?.(i + 1, cached.pages.length)
        }
        impl.markComplete()
        return
      }

      // L3: full render (MathJax → canvas → dither → tile).
      // streamDocumentPages fires onTotalKnown right after layout (before any
      // page is painted) so the loading screen can show "0/N" immediately.
      // Pages are then painted and sliced one by one; the reader can start once
      // the first page is ready, while the rest render in the background.
      await streamDocumentPages(
        entry.body,
        { pageH: READING_PAGE_H, pad: READING_PAD },
        async (bitmap, index, total) => {
          const page = await slicePage(bitmap)
          impl.setPage(index, page)
          callbacks.onPageReady?.(index)
          callbacks.onProgress?.(index + 1, total)
          // L2 write — fire-and-forget; large files (>MAX_CACHED_PAGES) are
          // silently skipped by cacheDocPage.
          cacheDocPage(RENDER_VERSION, hash, index, total, page)
        },
        total => {
          impl.setTotalPages(total)
          callbacks.onTotalKnown?.(total)
          callbacks.onProgress?.(0, total)
        },
      )
      if (impl.totalPages === 0) {
        // streamDocumentPages guarantees at least 1 page, but guard anyway.
        impl.setTotalPages(1)
      }
      impl.markComplete()
    } catch (err) {
      memCache.delete(cacheKey) // evict so a retry can re-render
      impl.markFailed(err instanceof Error ? err : new Error(String(err)))
    }
  })()

  return impl
}

// Re-export Page type for callers that only need the interface.
export type { Tile }
