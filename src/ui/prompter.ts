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
import { loadSpeed, saveSpeed, formatSpeed } from '../teleprompter/speed'
import { gestureToAction } from '../teleprompter/gestures'
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
  /** Update the native-text menu region (the on-glass library/file screens). */
  setMessage(text: string): Promise<void>
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
  // Mirror the loader onto the glasses too. We're still in menu/text mode here
  // (the image layout is only entered later in runReader), so a native-text
  // message lands — the phone already shows the same progress.
  void glasses.setMessage(glassesLoadingText(entry, 0, 0)).catch(() => {})
  void glasses.setStatus('preparing pages…').catch(() => {})

  void (async () => {
    let doc: PagedDoc
    try {
      doc = await paginateDocument(entry, (done, total) => {
        if (disposed) return
        renderLoading(root, entry, done, total)
        void glasses.setMessage(glassesLoadingText(entry, done, total)).catch(() => {})
      })
    } catch (err) {
      if (!disposed) renderError(root, entry, String(err), hooks.onBack)
      return
    }
    if (disposed) return

    if (doc.pages.length === 0) {
      renderError(root, entry, 'document is empty — nothing to show', hooks.onBack)
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

  // The glasses' bottom status line shows "N / total" on the left and a live
  // countdown to the next flip on the right. We only push it over BLE when the
  // visible text actually changes (the countdown integer or the page), so the
  // per-frame onProgress can drive it without flooding the native-text channel.
  let lastStatus = ''
  const pushStatus = (text: string) => {
    if (text === lastStatus) return
    lastStatus = text
    void glasses.setStatus(text).catch(() => {})
  }

  // Refresh the countdown (phone label + glasses status line) from the current
  // dwell fraction. Active only while autoscrolling and not mid-push; otherwise
  // it clears to just the page indicator.
  const updateCountdown = (fraction: number) => {
    const s = last
    const active = !!s && s.playing && !s.busy && !s.atEnd
    const remaining = active ? Math.max(0, Math.ceil(s!.secPerPage * (1 - fraction))) : null
    els.countdown.textContent = remaining == null ? '' : `next page in: ${formatCountdown(remaining)}`
    pushStatus(glassStatusLine(s ? s.index : engine.getIndex(), total, remaining))
  }

  // Paint a page on the phone (preview) and on the glasses (tiles). Awaited by the
  // engine, so the next dwell starts only once the slow tile push has landed. The
  // status line (page indicator + countdown) is driven by onState/onProgress.
  const showPage = async (index: number) => {
    const page: Page = doc.pages[index]
    els.image.src = page.preview
    els.counter.textContent = `${index + 1} / ${total}`
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
      // When not actively counting down (paused / pushing / at end), refresh the
      // status line to just the page indicator and clear the phone countdown.
      if (!s.playing || s.busy || s.atEnd) updateCountdown(1)
    },
    onProgress: fraction => {
      els.dwell.style.width = `${Math.round(fraction * 100)}%`
      updateCountdown(fraction)
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

  // Brief on-glasses feedback (native text line) on play/pause. Routed through
  // pushStatus so it keeps `lastStatus` in sync — otherwise the next countdown
  // tick (same page text) could be deduped away and the flash would stick.
  const flashStatus = (text: string) => pushStatus(text)

  // Single exit path (back button, double-tap, or app closed on the glasses):
  // unsubscribe, stop the engine, restore the menu layout, return to the File screen.
  let exited = false
  const exitReader = async () => {
    if (exited) return
    exited = true
    markDisposed()
    unsubscribe()
    engine.dispose()
    await glasses.exitReading().catch(() => {})
    hooks.onBack()
  }

  // Iteration 5 — drive the reader from glasses gestures. Mapping lives in
  // teleprompter/gestures; here we only execute the resulting action. Swipes now
  // PAGE (next/prev): a manual flip keeps the current play state and, if playing,
  // resets the dwell countdown (engine.goTo restarts it) — so autoscroll never
  // stops, it just re-times from the page you jumped to. Speed is the phone slider.
  const handleGesture = (event: InputEvent) => {
    const action = gestureToAction(event.type)
    if (!action) return
    switch (action) {
      case 'toggle':
        engine.toggle() // onState fires synchronously → `last` is fresh below
        flashStatus(last?.playing ? `reading · ${posLabel(last)}` : `paused · ${posLabel(last)}`)
        break
      case 'next':
        void engine.next()
        break
      case 'prev':
        void engine.prev()
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
  // Autoplay from the first page — opening a file goes straight into reading
  // (no separate «Play» tap). play() no-ops on a 1-page doc or if disposed.
  if (!isDisposed()) engine.play()
}

// ── Views ────────────────────────────────────────────────────────────────────

interface Refs {
  image: HTMLImageElement
  counter: HTMLElement
  countdown: HTMLElement
  sub: HTMLElement
  dwell: HTMLElement
  back: HTMLElement
}

function grabRefs(root: HTMLElement): Refs {
  return {
    image: root.querySelector<HTMLImageElement>('#page')!,
    counter: root.querySelector<HTMLElement>('#counter')!,
    countdown: root.querySelector<HTMLElement>('#countdown')!,
    sub: root.querySelector<HTMLElement>('#sub')!,
    dwell: root.querySelector<HTMLElement>('#dwell')!,
    back: root.querySelector<HTMLElement>('#back')!,
  }
}

/**
 * The glasses' bottom status line: page indicator on the left, countdown to the
 * next flip on the right. The native status region is ~25 chars wide and behind
 * the 2-tile page (which covers only the top half), so this reads in the blank
 * bottom band. `remainingSec == null` (paused / pushing) drops the countdown.
 */
function glassStatusLine(index: number, total: number, remainingSec: number | null): string {
  const left = `${index + 1} / ${total}`
  const right = remainingSec == null ? '' : formatCountdown(remainingSec)
  const pad = Math.max(2, 22 - left.length - right.length)
  return left + ' '.repeat(pad) + right
}

/** Compact countdown: `m:ss` from a minute up, otherwise `Ns`. */
function formatCountdown(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }
  return `${sec}s`
}

/** Short "n/total" position for the on-glasses status flashes. */
function posLabel(s: ScrollState | null): string {
  if (!s) return ''
  return `${s.index + 1}/${s.pageCount}`
}

function pageSub(s: ScrollState): string {
  if (s.busy) return 'sending page to glasses…'
  if (s.atEnd && !s.playing) return 'end of document'
  return s.playing ? `autoscroll · ${formatSpeed(s.secPerPage)}` : 'paused · press «Play»'
}

function renderReader(root: HTMLElement, doc: PagedDoc, initialSpeed: number) {
  root.innerHTML = shell(`
    <button class="back" id="back">← File</button>
    <h1 class="h1">${escapeHtml(doc.title)}</h1>
    <p class="sub" id="sub">paused · press «Play»</p>
    <div class="surface">
      <img id="page" class="page" alt="page"/>
      <div class="dwell-track"><div class="dwell-fill" id="dwell"></div></div>
    </div>
    <div class="meta"><span class="countdown" id="countdown"></span><span class="pos" id="counter">1 / ${doc.pages.length}</span></div>
    ${controlsHtml(initialSpeed)}
    <p class="note">What you see here is the real 4-bit raster sent to the glasses
      (top half 576×144, 2 tiles). Autoscroll holds the dwell on each page only
      after it has been fully pushed to the glasses, so a slow BLE push never eats
      into reading time. On the glasses: swipe up — next page, down —
      previous, tap — pause/play.</p>
  `)
}

/** Native-text loader for the glasses while pages render (mirrors the phone bar). */
function glassesLoadingText(entry: LibraryEntry, done: number, total: number): string {
  const head = entry.title.length > 24 ? entry.title.slice(0, 23) + '…' : entry.title
  const prog = total ? `Loading pages… ${done}/${total}` : 'Rendering math…'
  return `${head}\n\n${prog}`
}

function renderLoading(root: HTMLElement, entry: LibraryEntry, done: number, total: number) {
  const pct = total ? Math.round((done / total) * 100) : 0
  root.innerHTML = shell(`
    <h1 class="h1">${escapeHtml(entry.title)}</h1>
    <p class="sub">Preparing pages for the glasses…</p>
    <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
    <p class="sub">${total ? `${done}/${total} pages` : 'rendering math…'}</p>
  `)
}

function renderError(root: HTMLElement, entry: LibraryEntry, msg: string, onBack: () => void) {
  root.innerHTML = shell(`
    <button class="back" id="back">← File</button>
    <h1 class="h1">${escapeHtml(entry.title)}</h1>
    <p class="err">Failed to render: ${escapeHtml(msg)}</p>
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
  .meta { display:flex; justify-content:space-between; align-items:baseline; margin:8px 0 0; }
  .countdown { color:#5fbf5f; font-size:13px; font-variant-numeric:tabular-nums; min-height:1em; }
  .pos { color:#8a8a8a; font-size:13px; }
  .note { color:#7a7a7a; font-size:11.5px; margin:16px 0 0; line-height:1.4; }
  .err { color:#e29b9b; font:13px ui-monospace,monospace; margin:10px 0; }
${CONTROLS_STYLE}
</style>`
