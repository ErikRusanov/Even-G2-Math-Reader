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
// of the touchpad/ring (SCROLL_TOP → 'scrollUp') means "read FASTER" (shorter
// dwell per page); toward the bottom means "slower". This mirrors a teleprompter
// where pushing the text up speeds it along. If real hardware reports the
// physical direction inverted, swap the two `scroll*` cases below — that's the
// only edit needed.
//
//   tap        → play / pause
//   scrollUp   → faster   (−dwell)
//   scrollDown → slower   (+dwell)
//   doubleTap  → leave the reader (back to the File screen)
//   exit       → app closed on the glasses → leave the reader
// ─────────────────────────────────────────────────────────────────────────

import type { InputType } from '../glasses/types'

export type ReaderAction = 'toggle' | 'faster' | 'slower' | 'exit'

/** Map a normalized glasses gesture to a reader action, or null to ignore it. */
export function gestureToAction(type: InputType): ReaderAction | null {
  switch (type) {
    case 'tap':
      return 'toggle'
    case 'scrollUp':
      return 'faster'
    case 'scrollDown':
      return 'slower'
    case 'doubleTap':
      return 'exit'
    case 'exit':
      return 'exit'
    default:
      return null
  }
}
