// ─────────────────────────────────────────────────────────────────────────
// Reader screen (Iteration 3) — manual paged reading on the glasses.
//
// On open it renders the whole file to glasses-ready pages (progress bar), then
// shows page 1 and lets the user flip with ‹ Prev / Next › (or tapping the
// preview). Each flip pushes that page's 4 tiles to the glasses through the
// GlassesControl abstraction and mirrors the SAME 4-bit bitmap on the phone (the
// green preview) — so phone and glasses never desync.
//
// This screen owns the glasses' IMAGE mode: it switches the surface to the 2×2
// image layout on enter and back to native-text on leave, so the library/file
// menus keep working over the native text path.
// ─────────────────────────────────────────────────────────────────────────

import { paginateDocument, type Page } from '../teleprompter/pages'
import type { LibraryEntry } from '../library/load'
import type { Tile } from '../render/slice'

/**
 * What the reader needs from the glasses, abstracted from the SDK adapter so the
 * UI never imports `@evenrealities/even_hub_sdk`. Implemented in main.ts over
 * GlassesAdapter; a no-op when no glasses are connected (desktop dev).
 */
export interface GlassesControl {
  /** Whether a glasses bridge is actually connected. */
  readonly available: boolean
  /** Switch the surface to the 4-tile image layout (clears menu text). */
  enterReading(): Promise<void>
  /** Push one page's tiles (serialized by the adapter). */
  showPage(tiles: Tile[]): Promise<void>
  /** Restore the native-text layout for menus. */
  exitReading(): Promise<void>
  setStatus(text: string): Promise<void>
}

export interface ReaderHooks {
  /** Return to the File screen. */
  onBack: () => void
}

export function mountReader(
  root: HTMLElement,
  entry: LibraryEntry,
  glasses: GlassesControl,
  hooks: ReaderHooks,
): void {
  let disposed = false
  renderLoading(root, entry, 0, 0)

  void (async () => {
    let doc
    try {
      doc = await paginateDocument(entry, (done, total) => {
        if (!disposed) renderLoading(root, entry, done, total)
      })
    } catch (err) {
      if (!disposed) renderError(root, entry, String(err), hooks.onBack)
      return
    }
    if (disposed) return

    let index = 0
    const dispose = () => {
      disposed = true
    }

    const show = async () => {
      const page = doc!.pages[index]
      renderPage(root, doc!, index, page, {
        onPrev: () => {
          if (index > 0) {
            index--
            void show()
          }
        },
        onNext: () => {
          if (index < doc!.pages.length - 1) {
            index++
            void show()
          }
        },
        onBack: async () => {
          dispose()
          await glasses.exitReading().catch(() => {})
          hooks.onBack()
        },
      })
      await glasses.setStatus(`${doc!.title} · ${index + 1}/${doc!.pages.length}`).catch(() => {})
      await glasses.showPage(page.tiles).catch(() => {})
    }

    await glasses.enterReading().catch(() => {})
    await show()
  })()
}

// ── Views ────────────────────────────────────────────────────────────────────

function renderLoading(root: HTMLElement, entry: LibraryEntry, done: number, total: number) {
  const pct = total ? Math.round((done / total) * 100) : 0
  root.innerHTML = shell(`
    <h1 class="h1">${escapeHtml(entry.title)}</h1>
    <p class="sub">Подготовка страниц для очков…</p>
    <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
    <p class="sub">${total ? `${done}/${total} страниц` : 'рендер математики…'}</p>
  `)
}

function renderError(root: HTMLElement, entry: LibraryEntry, msg: string, onBack: () => void) {
  root.innerHTML = shell(`
    <button class="back" id="back">← Файл</button>
    <h1 class="h1">${escapeHtml(entry.title)}</h1>
    <p class="err">Не удалось отрендерить: ${escapeHtml(msg)}</p>
  `)
  root.querySelector('#back')!.addEventListener('click', onBack)
}

interface PageHandlers {
  onPrev: () => void
  onNext: () => void
  onBack: () => void | Promise<void>
}

function renderPage(root: HTMLElement, doc: { title: string; pages: Page[] }, index: number, page: Page, h: PageHandlers) {
  const total = doc.pages.length
  root.innerHTML = shell(`
    <button class="back" id="back">← Файл</button>
    <h1 class="h1">${escapeHtml(doc.title)}</h1>
    <p class="sub">Страница ${index + 1} из ${total} · ${pageHint()}</p>
    <div class="surface"><img id="page" class="page" src="${page.preview}" alt="страница ${index + 1}"/></div>
    <div class="nav">
      <button class="nav-btn" id="prev" ${index === 0 ? 'disabled' : ''}>‹ Назад</button>
      <span class="nav-pos">${index + 1} / ${total}</span>
      <button class="nav-btn" id="next" ${index >= total - 1 ? 'disabled' : ''}>Вперёд ›</button>
    </div>
    <p class="note">То, что вы видите здесь — реальный 4-bit растр, уходящий на очки
      (576×288, 4 тайла). Листание ручное; автоскролл — итерация 4.</p>
  `)
  root.querySelector('#back')!.addEventListener('click', () => void h.onBack())
  root.querySelector('#prev')!.addEventListener('click', h.onPrev)
  root.querySelector('#next')!.addEventListener('click', h.onNext)
  // Tapping the preview advances (right) — a phone-side stand-in for a glasses tap.
  root.querySelector('#page')!.addEventListener('click', h.onNext)
}

function pageHint(): string {
  return 'листайте ‹ / ›'
}

// ── Shell + helpers ────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function shell(inner: string): string {
  return `<main class="screen">${inner}</main>${STYLE}`
}

const STYLE = `<style>
  .screen { margin:auto; padding:18px 16px 40px; max-width:680px; width:100%; box-sizing:border-box;
            font-family:system-ui,-apple-system,sans-serif; }
  .h1 { font-size:19px; font-weight:600; margin:0 0 4px; color:#E5E5E5; }
  .sub { color:#919191; font-size:13px; margin:0 0 12px; }
  .back { background:#2a2a2a; color:#e5e5e5; border:1px solid #444; border-radius:6px;
          padding:7px 12px; font-size:13px; cursor:pointer; margin-bottom:12px; }
  .bar { height:8px; background:#1a1a1a; border:1px solid #333; border-radius:5px; overflow:hidden; margin:6px 0 10px; }
  .bar-fill { height:100%; background:#5fbf5f; transition:width .15s ease; }
  /* The glasses surface, shown at its true 2:1 aspect on a black field. */
  .surface { background:#000; border:1px solid #2c2c2c; border-radius:8px; padding:0; overflow:hidden;
             aspect-ratio:576/288; display:flex; align-items:center; justify-content:center; }
  .page { width:100%; height:100%; image-rendering:pixelated; object-fit:contain; cursor:pointer; display:block; }
  .nav { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:14px 0 0; }
  .nav-btn { flex:1; background:#15240f; color:#9be29b; border:1px solid #2f4d22; border-radius:8px;
             padding:11px 12px; font-size:15px; font-weight:600; cursor:pointer; }
  .nav-btn:disabled { opacity:.4; cursor:default; }
  .nav-pos { color:#8a8a8a; font-size:13px; min-width:54px; text-align:center; }
  .note { color:#7a7a7a; font-size:11.5px; margin:16px 0 0; line-height:1.4; }
  .err { color:#e29b9b; font:13px ui-monospace,monospace; margin:10px 0; }
</style>`
