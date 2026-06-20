// ─────────────────────────────────────────────────────────────────────────
// Scroll speed — units, clamping, formatting, and per-file persistence.
//
// Speed is expressed as **seconds of dwell per page** (sec/page): the reader
// looks at a page for N seconds, then it auto-advances. Lower = faster. This is
// the natural unit for our DISCRETE-page document (Iter 3): the BLE push of a
// page's 4 tiles is slow, so we time the pause AFTER a page is fully on-glass
// rather than trying to scroll continuously.
//
// The chosen speed is persisted per file id in localStorage so re-opening a
// lecture restores how fast you were reading it. (Position persistence is
// Iteration 6.)
// ─────────────────────────────────────────────────────────────────────────

export const MIN_SEC_PER_PAGE = 2
export const MAX_SEC_PER_PAGE = 180 // up to 3 min/page for dense math you sit with
export const DEFAULT_SEC_PER_PAGE = 8

/** Coerce any number into the supported range; fall back to the default on NaN. */
export function clampSpeed(sec: number): number {
  if (!Number.isFinite(sec)) return DEFAULT_SEC_PER_PAGE
  return Math.min(MAX_SEC_PER_PAGE, Math.max(MIN_SEC_PER_PAGE, Math.round(sec)))
}

/** Human label: `8 s/page` under a minute, `2:30 min/page` at/above one. */
export function formatSpeed(sec: number): string {
  const s = clampSpeed(sec)
  if (s < 60) return `${s} s/page`
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm}:${String(ss).padStart(2, '0')} min/page`
}

/**
 * Step the speed one notch faster or slower — coarse on-glasses control (swipe ±,
 * Iteration 5). The step is multiplicative (~25% per swipe) so one gesture feels
 * the same across the whole 2…180 s/page range instead of crawling 1 s at a time
 * at the slow end. Always returns an in-range value.
 */
export function stepSpeed(sec: number, direction: 'faster' | 'slower'): number {
  const cur = clampSpeed(sec)
  const delta = Math.max(1, Math.round(cur * 0.25))
  return clampSpeed(direction === 'faster' ? cur - delta : cur + delta)
}

const storageKey = (id: string) => `g2reader:speed:${id}`

/** The last speed used for this file, or the default if none/no storage. */
export function loadSpeed(id: string): number {
  try {
    const raw = localStorage.getItem(storageKey(id))
    if (raw != null) return clampSpeed(parseFloat(raw))
  } catch {
    /* no localStorage (private mode / non-browser) — use default */
  }
  return DEFAULT_SEC_PER_PAGE
}

/** Remember the speed for this file. Best-effort; storage failures are ignored. */
export function saveSpeed(id: string, sec: number): void {
  try {
    localStorage.setItem(storageKey(id), String(clampSpeed(sec)))
  } catch {
    /* ignore */
  }
}
