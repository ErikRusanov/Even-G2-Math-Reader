// ─────────────────────────────────────────────────────────────────────────
// Autoscroll engine (Iteration 4) — auto-advances the paged document on a timer.
//
// The document is a list of DISCRETE pages (Iter 3), each one a full 576×288
// surface = 4 image tiles pushed serially over BLE. The host warned that
// repainting the whole surface is slow (several seconds), so the engine is built
// around one rule: **never overlap a page push with a dwell or another push.**
// The cycle is therefore:
//
//     showPage(i)  ── await the (slow) push ──►  dwell secPerPage seconds  ──►  showPage(i+1) ──► …
//
// `secPerPage` times the PAUSE once a page is fully on-glass, not the wall-clock
// per page — so a slow BLE push never eats into reading time, and pushes can't
// pile up. The dwell uses a requestAnimationFrame accumulator (vs a single long
// setTimeout) so the phone can show a smooth countdown bar and live speed changes
// take effect immediately.
//
// The engine is transport-only: it owns index / play state / speed and calls back
// to `showPage` (which does the actual phone+glasses paint) and to `onState` /
// `onProgress` (which update the UI). It imports no SDK and no DOM beyond rAF.
// ─────────────────────────────────────────────────────────────────────────

export interface ScrollState {
  index: number
  pageCount: number
  playing: boolean
  secPerPage: number
  /** True while at the last page (autoplay stops here). */
  atEnd: boolean
  /** True while a page is being pushed to the glasses (transport is locked). */
  busy: boolean
}

export interface ScrollEngineOptions {
  pageCount: number
  secPerPage: number
  initialIndex?: number
  /**
   * Paint page `index` everywhere it needs to go (phone preview + glasses tiles)
   * and resolve once the (slow) glasses push has completed. The engine awaits
   * this before starting the dwell, so it is the single backpressure point.
   */
  showPage: (index: number) => Promise<void>
  /** Structural state changed (index / playing / speed / busy) — re-sync controls. */
  onState: (state: ScrollState) => void
  /** Dwell progress 0→1 on the current page. Fires every frame — keep it cheap. */
  onProgress?: (fraction: number) => void
}

function clampIndex(index: number, pageCount: number): number {
  return Math.max(0, Math.min(index, pageCount - 1))
}

export class ScrollEngine {
  private index: number
  private playing = false
  private secPerPage: number
  private busy = false
  private raf: number | null = null
  private dwellStart = 0
  private disposed = false

  constructor(private readonly opts: ScrollEngineOptions) {
    this.index = clampIndex(opts.initialIndex ?? 0, opts.pageCount)
    this.secPerPage = opts.secPerPage
  }

  /** Push the first page and emit the initial state. Call once after construction. */
  async start(): Promise<void> {
    await this.goTo(this.index)
  }

  getIndex(): number {
    return this.index
  }

  play(): void {
    if (this.disposed || this.playing || this.atEnd()) return
    this.playing = true
    this.emit()
    // If a push is in flight, goTo()'s tail will start the dwell once it lands.
    if (!this.busy) this.startDwell()
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    this.stopDwell()
    this.opts.onProgress?.(0)
    this.emit()
  }

  toggle(): void {
    this.playing ? this.pause() : this.play()
  }

  /** Manual step forward. Keeps the current play state (resumes dwell from the new page). */
  async next(): Promise<void> {
    if (this.busy || this.atEnd()) return
    await this.goTo(this.index + 1)
  }

  /** Manual step back. */
  async prev(): Promise<void> {
    if (this.busy || this.index === 0) return
    await this.goTo(this.index - 1)
  }

  /** Live speed change. Restarts the current page's countdown with the new duration. */
  setSpeed(sec: number): void {
    this.secPerPage = sec
    this.emit()
    if (this.playing && !this.busy) this.startDwell()
  }

  dispose(): void {
    this.disposed = true
    this.playing = false
    this.stopDwell()
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private atEnd(): boolean {
    return this.index >= this.opts.pageCount - 1
  }

  private emit(): void {
    if (this.disposed) return
    this.opts.onState({
      index: this.index,
      pageCount: this.opts.pageCount,
      playing: this.playing,
      secPerPage: this.secPerPage,
      atEnd: this.atEnd(),
      busy: this.busy,
    })
  }

  /**
   * Move to `index`, push it (awaiting the slow paint), then resume the dwell if
   * we're still playing. This is the ONLY place a page is shown, so pushes are
   * inherently serialized and never overlap a dwell.
   */
  private async goTo(index: number): Promise<void> {
    this.stopDwell()
    this.index = clampIndex(index, this.opts.pageCount)
    this.busy = true
    this.opts.onProgress?.(0)
    this.emit()
    try {
      await this.opts.showPage(this.index)
    } finally {
      this.busy = false
    }
    if (this.disposed) return
    this.emit()
    if (this.playing) {
      if (this.atEnd()) this.pause()
      else this.startDwell()
    }
  }

  private startDwell(): void {
    this.stopDwell()
    this.dwellStart = performance.now()
    const durationMs = this.secPerPage * 1000
    const tick = () => {
      if (this.disposed || !this.playing) return
      const elapsed = performance.now() - this.dwellStart
      const fraction = durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs)
      this.opts.onProgress?.(fraction)
      if (fraction >= 1) {
        this.raf = null
        if (this.atEnd()) this.pause()
        else void this.goTo(this.index + 1)
      } else {
        this.raf = requestAnimationFrame(tick)
      }
    }
    this.raf = requestAnimationFrame(tick)
  }

  private stopDwell(): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
  }
}
