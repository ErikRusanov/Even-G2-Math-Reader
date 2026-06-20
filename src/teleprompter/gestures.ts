// ─────────────────────────────────────────────────────────────────────────
// Gesture → reader action map (Iteration 5 — on-glasses control).
//
// The `src/glasses/` adapter already normalizes raw protobuf events into
// SDK-agnostic gestures (tap / doubleTap / scrollUp / scrollDown / exit, with a
// source). This module is the ONE place that maps those generic gestures onto
// reader-specific intent, so the adapter stays free of teleprompter concepts and
// the binding is trivial to retune after eyes-on-glass.
//
// Direction convention — PENDING eyes-on-glass (Iter 5): a swipe toward the TOP
// of the touchpad/ring (SCROLL_TOP → 'scrollUp') flips to the NEXT page; toward
// the bottom goes to the PREVIOUS one. This mirrors a teleprompter where pushing
// the text up reveals what comes next. If real hardware reports the physical
// direction inverted, swap the two `scroll*` cases below — that's the only edit
// needed. (Speed is set from the phone slider; swipes are pure navigation now.)
//
//   tap        → play / pause
//   scrollUp   → next page  (autoscroll keeps running; its dwell timer resets)
//   scrollDown → previous page
//   doubleTap  → leave the reader (back to the File screen)
//   exit       → app closed on the glasses → leave the reader
// ─────────────────────────────────────────────────────────────────────────

import type { InputType } from '../glasses/types'

export type ReaderAction = 'toggle' | 'next' | 'prev' | 'exit'

/** Map a normalized glasses gesture to a reader action, or null to ignore it. */
export function gestureToAction(type: InputType): ReaderAction | null {
  switch (type) {
    case 'tap':
      return 'toggle'
    case 'scrollUp':
      return 'next'
    case 'scrollDown':
      return 'prev'
    case 'doubleTap':
      return 'exit'
    case 'exit':
      return 'exit'
    default:
      return null
  }
}
