// ─────────────────────────────────────────────────────────────────────────
// Reader controls (Iteration 4) — the phone-side transport + speed panel.
//
// Renders the play/pause + step buttons and the speed slider that drive the
// autoscroll engine, and returns a small handle the prompter uses to push engine
// state back into the DOM (without re-rendering, so the slider keeps focus and
// the page image never flickers). Speed is in sec/page (see teleprompter/speed).
// ─────────────────────────────────────────────────────────────────────────

import { MIN_SEC_PER_PAGE, MAX_SEC_PER_PAGE, formatSpeed } from '../teleprompter/speed'

export interface ControlHandlers {
  onToggle: () => void
  onPrev: () => void
  onNext: () => void
  /** Fired on every slider move with the new sec/page (already an integer). */
  onSpeed: (sec: number) => void
}

/** Live handle into the rendered controls; the engine's onState calls these. */
export interface ControlHandle {
  setPlaying(playing: boolean): void
  setNav(canPrev: boolean, canNext: boolean): void
  setBusy(busy: boolean): void
  /** Reflect a speed value into the slider + label (e.g. when restored from storage). */
  setSpeed(sec: number): void
}

/** Controls markup, to drop inside the reader shell. Bound separately. */
export function controlsHtml(initialSec: number): string {
  return `
    <div class="ctl">
      <div class="transport">
        <button class="ctl-step" data-act="prev" aria-label="Back">‹</button>
        <button class="ctl-play" data-act="play">▶ Play</button>
        <button class="ctl-step" data-act="next" aria-label="Forward">›</button>
      </div>
      <div class="speed">
        <div class="speed-row"><span>Speed</span><span class="speed-val">${formatSpeed(initialSec)}</span></div>
        <input class="speed-range" type="range" min="${MIN_SEC_PER_PAGE}" max="${MAX_SEC_PER_PAGE}"
               step="1" value="${initialSec}" />
        <div class="speed-ends"><span>fast</span><span>slow</span></div>
      </div>
    </div>`
}

/** Wire the rendered controls to handlers and return the live update handle. */
export function bindControls(root: HTMLElement, handlers: ControlHandlers): ControlHandle {
  const play = root.querySelector<HTMLButtonElement>('.ctl-play')!
  const prev = root.querySelector<HTMLButtonElement>('[data-act="prev"]')!
  const next = root.querySelector<HTMLButtonElement>('[data-act="next"]')!
  const range = root.querySelector<HTMLInputElement>('.speed-range')!
  const val = root.querySelector<HTMLElement>('.speed-val')!

  play.addEventListener('click', handlers.onToggle)
  prev.addEventListener('click', handlers.onPrev)
  next.addEventListener('click', handlers.onNext)
  range.addEventListener('input', () => {
    const sec = parseInt(range.value, 10)
    val.textContent = formatSpeed(sec)
    handlers.onSpeed(sec)
  })

  return {
    setPlaying(playing) {
      play.textContent = playing ? '⏸ Pause' : '▶ Play'
      play.classList.toggle('is-playing', playing)
    },
    setNav(canPrev, canNext) {
      prev.disabled = !canPrev
      next.disabled = !canNext
    },
    setBusy(busy) {
      // Lock transport while a page is being pushed (pushes must not overlap).
      play.disabled = busy
      root.querySelector('.ctl')!.classList.toggle('is-busy', busy)
    },
    setSpeed(sec) {
      range.value = String(sec)
      val.textContent = formatSpeed(sec)
    },
  }
}

export const CONTROLS_STYLE = `
  .ctl { margin:14px 0 0; display:flex; flex-direction:column; gap:14px; }
  .ctl.is-busy { opacity:.85; }
  .transport { display:flex; align-items:stretch; gap:10px; }
  .ctl-step { width:54px; background:#15240f; color:#9be29b; border:1px solid #2f4d22;
              border-radius:8px; font-size:20px; line-height:1; cursor:pointer; }
  .ctl-step:disabled { opacity:.35; cursor:default; }
  .ctl-play { flex:1; background:#1b3013; color:#bdf0bd; border:1px solid #3c6a2c;
              border-radius:8px; padding:12px; font-size:16px; font-weight:700; cursor:pointer; }
  .ctl-play.is-playing { background:#241a0f; color:#f0d9bd; border-color:#6a4f2c; }
  .ctl-play:disabled { opacity:.5; cursor:default; }
  .speed { background:#161616; border:1px solid #2c2c2c; border-radius:8px; padding:10px 12px; }
  .speed-row { display:flex; justify-content:space-between; font-size:13px; color:#c7c7c7; margin-bottom:6px; }
  .speed-val { color:#9be29b; font-weight:600; }
  .speed-range { width:100%; accent-color:#5fbf5f; }
  .speed-ends { display:flex; justify-content:space-between; font-size:11px; color:#7a7a7a; margin-top:2px; }`
