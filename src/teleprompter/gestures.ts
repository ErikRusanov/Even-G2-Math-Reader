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

// ─────────────────────────────────────────────────────────────────────────
// Library-menu gestures (on-glass file selection — Iteration 7).
//
// The phone selects files by tapping; the glasses drive the SAME navigation
// with gestures. This is the menu counterpart of gestureToAction, kept here so
// every gesture→intent binding lives in one module.
//
//   scrollUp   → move the highlight UP   (toward earlier files)
//   scrollDown → move the highlight DOWN (toward later files)
//   tap        → select (open the highlighted file / start reading)
//   doubleTap  → back  (File → Library)
//   exit       → app closed on the glasses → treat as back
//
// Swap the two scroll* cases if hardware reports the direction inverted (the
// same documented assumption as the reader map above).
// ─────────────────────────────────────────────────────────────────────────

export type MenuAction = 'up' | 'down' | 'select' | 'back'

/** Map a normalized glasses gesture to a library-menu action, or null to ignore. */
export function menuGestureToAction(type: InputType): MenuAction | null {
  switch (type) {
    case 'scrollUp':
      return 'up'
    case 'scrollDown':
      return 'down'
    case 'tap':
      return 'select'
    case 'doubleTap':
      return 'back'
    case 'exit':
      return 'back'
    default:
      return null
  }
}
