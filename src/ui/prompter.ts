// ─────────────────────────────────────────────────────────────────────────
// Reader screen — autoscroll reading on the glasses (Iteration 4).
//
// On open it eagerly renders the whole file to glasses-ready pages (progress
// bar), then drives a ScrollEngine that auto-advances pages on a timer. The phone
// shows transport controls (play/pause, step, speed slider) and mirrors the SAME
// 4-bit page bitmap the glasses receive, with a dwell countdown bar so you can
// see when the next flip is coming. Speed (sec/page) is persisted per file.
//
// The reader owns the glasses' IMAGE mode: it switches the surface to the 2×2
// image layout on enter and back to native-text on leave, so menus keep working
// over the native text path. All glasses calls go through GlassesControl, so this
// UI never imports the SDK.
//
// The reader shell is rendered ONCE; engine callbacks then mutate just the bits
// that change (page image, counter, play button, nav, dwell bar) — no per-frame
// innerHTML churn, so the slider keeps focus and the image never flickers.
// ─────────────────────────────────────────────────────────────────────────

import { paginateDocument, type Page, type PagedDoc } from '../teleprompter/pages'
import { ScrollEngine, type ScrollState } from '../teleprompter/engine'
import { loadSpeed, saveSpeed, formatSpeed, clampSpeed, stepSpeed } from '../teleprompter/speed'
import { gestureToAction } from '../teleprompter/gestures'
import { renderSpeedHudTiles, bottomTiles } from '../teleprompter/hud'
import { controlsHtml, bindControls, CONTROLS_STYLE } from './settings'
import type { LibraryEntry } from '../library/load'
import type { Tile } from '../render/slice'
import type { InputEvent } from '../glasses/types'

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
  /**
   * Subscribe to normalized glasses gestures (tap / swipe / exit) while reading.
   * Returns an unsubscribe fn. A no-op (returns `() => {}`) when no glasses are
   * connected — the phone controls remain the baseline.
   */
  onInput(handler: (event: InputEvent) => void): () => void
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
    let doc: PagedDoc
    try {
      doc = await paginateDocument(entry, (done, total) => {
        if (!disposed) renderLoading(root, entry, done, total)
      })
    } catch (err) {
      if (!disposed) renderError(root, entry, String(err), hooks.onBack)
      return
    }
    if (disposed) return

    if (doc.pages.length === 0) {
      renderError(root, entry, 'документ пуст — нечего показывать', hooks.onBack)
      return
    }

    await runReader(root, doc, entry, glasses, hooks, () => disposed, () => {
      disposed = true
    })
  })()
}

async function runReader(
  root: HTMLElement,
  doc: PagedDoc,
  entry: LibraryEntry,
  glasses: GlassesControl,
  hooks: ReaderHooks,
  isDisposed: () => boolean,
  markDisposed: () => void,
): Promise<void> {
  const total = doc.pages.length
  const initialSpeed = loadSpeed(entry.id)

  renderReader(root, doc, initialSpeed)
  const els = grabRefs(root)

  // Latest engine state, so glasses gestures can act on current index/speed/play.
  let last: ScrollState | null = null
  // Live unsubscribe for the glasses gesture stream (set once subscribed).
  let unsubscribe: () => void = () => {}

  // Paint a page on the phone (preview) and on the glasses (tiles). Awaited by the
  // engine, so the next dwell starts only once the slow tile push has landed.
  const showPage = async (index: number) => {
    const page: Page = doc.pages[index]
    els.image.src = page.preview
    els.counter.textContent = `${index + 1} / ${total}`
    await glasses.setStatus(`${doc.title} · ${index + 1}/${total}`).catch(() => {})
    await glasses.showPage(page.tiles).catch(() => {})
  }

  const engine = new ScrollEngine({
    pageCount: total,
    secPerPage: initialSpeed,
    showPage,
    onState: (s: ScrollState) => {
      last = s
      controls.setPlaying(s.playing)
      controls.setNav(s.index > 0 && !s.busy, !s.atEnd && !s.busy)
      controls.setBusy(s.busy)
      els.sub.textContent = pageSub(s)
    },
    onProgress: fraction => {
      els.dwell.style.width = `${Math.round(fraction * 100)}%`
    },
  })

  const controls = bindControls(root, {
    onToggle: () => engine.toggle(),
    onPrev: () => void engine.prev(),
    onNext: () => void engine.next(),
    onSpeed: sec => {
      engine.setSpeed(sec)
      saveSpeed(entry.id, sec)
    },
  })
  controls.setSpeed(initialSpeed)

  // Brief on-glasses feedback (native text line). Hidden behind the image tiles
  // while reading, so it only really shows in transitions — keep it for play/pause.
  const flashStatus = (text: string) => void glasses.setStatus(text).catch(() => {})

  // ── On-glasses speed HUD ──────────────────────────────────────────────────
  // A swipe changes speed; the status line is hidden behind the tiles, so paint a
  // transient slider into the bottom two tiles (like a TV volume bar) and restore
  // the clean tiles after a beat. Restores are guarded on the page index so a page
  // flip (which repaints all 4 tiles) is never clobbered by a stale restore.
  const HUD_VISIBLE_MS = 2200
  let hudTimer: ReturnType<typeof setTimeout> | null = null
  const clearHudTimer = () => {
    if (hudTimer != null) {
      clearTimeout(hudTimer)
      hudTimer = null
    }
  }
  const showSpeedHud = (speed: number) => {
    if (!glasses.available) return
    const idx = engine.getIndex()
    const page = doc.pages[idx]
    clearHudTimer()
    void (async () => {
      let tiles: Tile[]
      try {
        tiles = await renderSpeedHudTiles(page.tiles, speed)
      } catch {
        return
      }
      if (isDisposed() || engine.getIndex() !== idx) return // page moved — drop it
      await glasses.showPage(tiles).catch(() => {})
      if (isDisposed()) return
      hudTimer = setTimeout(() => {
        hudTimer = null
        if (isDisposed() || engine.getIndex() !== idx) return // a flip already cleaned up
        void glasses.showPage(bottomTiles(page.tiles)).catch(() => {})
      }, HUD_VISIBLE_MS)
    })()
  }

  // Apply a speed coming from the glasses (swipe): move the engine, the phone
  // slider, persistence, and the on-glass HUD together (the phone slider's own
  // handler only touches engine + storage, since it IS the source).
  const applySpeed = (sec: number) => {
    const clamped = clampSpeed(sec)
    engine.setSpeed(clamped)
    controls.setSpeed(clamped)
    saveSpeed(entry.id, clamped)
    showSpeedHud(clamped)
  }

  // Single exit path (back button, double-tap, or app closed on the glasses):
  // unsubscribe, stop the engine, restore the menu layout, return to the File screen.
  let exited = false
  const exitReader = async () => {
    if (exited) return
    exited = true
    markDisposed()
    unsubscribe()
    clearHudTimer()
    engine.dispose()
    await glasses.exitReading().catch(() => {})
    hooks.onBack()
  }

  // Iteration 5 — drive the reader from glasses gestures. Mapping lives in
  // teleprompter/gestures; here we only execute the resulting action.
  const handleGesture = (event: InputEvent) => {
    const action = gestureToAction(event.type)
    if (!action) return
    const speed = last?.secPerPage ?? initialSpeed
    switch (action) {
      case 'toggle':
        engine.toggle() // onState fires synchronously → `last` is fresh below
        flashStatus(last?.playing ? `чтение · ${posLabel(last)}` : `пауза · ${posLabel(last)}`)
        break
      case 'faster':
        applySpeed(stepSpeed(speed, 'faster'))
        break
      case 'slower':
        applySpeed(stepSpeed(speed, 'slower'))
        break
      case 'exit':
        void exitReader()
        break
    }
  }

  // Tapping the page preview = play/pause (phone stand-in for a glasses tap).
  els.image.addEventListener('click', () => engine.toggle())
  els.back.addEventListener('click', () => void exitReader())

  await glasses.enterReading().catch(() => {})
  if (isDisposed()) {
    engine.dispose()
    return
  }
  unsubscribe = glasses.onInput(handleGesture)
  await engine.start()
}

// ── Views ────────────────────────────────────────────────────────────────────

interface Refs {
  image: HTMLImageElement
  counter: HTMLElement
  sub: HTMLElement
  dwell: HTMLElement
  back: HTMLElement
}

function grabRefs(root: HTMLElement): Refs {
  return {
    image: root.querySelector<HTMLImageElement>('#page')!,
    counter: root.querySelector<HTMLElement>('#counter')!,
    sub: root.querySelector<HTMLElement>('#sub')!,
    dwell: root.querySelector<HTMLElement>('#dwell')!,
    back: root.querySelector<HTMLElement>('#back')!,
  }
}

/** Short "n/total" position for the on-glasses status flashes. */
function posLabel(s: ScrollState | null): string {
  if (!s) return ''
  return `${s.index + 1}/${s.pageCount}`
}

function pageSub(s: ScrollState): string {
  if (s.busy) return 'отправка страницы на очки…'
  if (s.atEnd && !s.playing) return 'конец документа'
  return s.playing ? `автоскролл · ${formatSpeed(s.secPerPage)}` : 'на паузе · нажмите «Старт»'
}

function renderReader(root: HTMLElement, doc: PagedDoc, initialSpeed: number) {
  root.innerHTML = shell(`
    <button class="back" id="back">← Файл</button>
    <h1 class="h1">${escapeHtml(doc.title)}</h1>
    <p class="sub" id="sub">на паузе · нажмите «Старт»</p>
    <div class="surface">
      <img id="page" class="page" alt="страница"/>
      <div class="dwell-track"><div class="dwell-fill" id="dwell"></div></div>
    </div>
    <div class="meta"><span class="pos" id="counter">1 / ${doc.pages.length}</span></div>
    ${controlsHtml(initialSpeed)}
    <p class="note">То, что вы видите здесь — реальный 4-bit растр, уходящий на очки
      (576×288, 4 тайла). Автоскролл выдерживает паузу на каждой странице после её
      полной отправки на очки, поэтому медленный BLE-пуш не съедает время чтения.</p>
  `)
}

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
  .surface { position:relative; background:#000; border:1px solid #2c2c2c; border-radius:8px; overflow:hidden;
             aspect-ratio:576/288; display:flex; align-items:center; justify-content:center; }
  .page { width:100%; height:100%; image-rendering:pixelated; object-fit:contain; cursor:pointer; display:block; }
  /* Dwell countdown — fills over secPerPage, then the page flips. */
  .dwell-track { position:absolute; left:0; right:0; bottom:0; height:4px; background:rgba(255,255,255,.08); }
  .dwell-fill { height:100%; width:0; background:#5fbf5f; }
  .meta { display:flex; justify-content:flex-end; margin:8px 0 0; }
  .pos { color:#8a8a8a; font-size:13px; }
  .note { color:#7a7a7a; font-size:11.5px; margin:16px 0 0; line-height:1.4; }
  .err { color:#e29b9b; font:13px ui-monospace,monospace; margin:10px 0; }
${CONTROLS_STYLE}
</style>`
