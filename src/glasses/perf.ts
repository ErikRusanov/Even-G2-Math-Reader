// ─────────────────────────────────────────────────────────────────────────
// Image-push perf bus (DIAGNOSTIC — Iteration-6 timing spike).
//
// Why this exists: page loads on real glasses are slow AND content-dependent
// (bilet-01 slide 1 ≈ 11 s, the denser slide 2 ≈ 30 s). Area-fixed BLE can't
// explain that, so payload size matters — but we don't yet know WHERE: the
// JS-side `number[]` serialization the SDK does to cross the WebView↔host bridge,
// or the host's own PNG-decode + gray4 + BLE. This bus carries a per-tile timing
// breakdown so the phone UI (and the console) can show it, and we decide the
// optimization from data instead of guessing.
//
// Decomposition (see GlassesAdapter.sendImage):
//   serMs   — time to build the SDK's JSON payload (Uint8Array → number[]).
//   totalMs — time for the whole `updateImageRawData` round-trip.
//   ⇒ netMs ≈ totalMs − serMs  ≈ host decode + gray4 + BLE.
// If serMs dominates → it's the bridge array build (reduce payload BYTES).
// If netMs dominates → it's host+BLE (reduce PIXELS / fewer tiles).
// ─────────────────────────────────────────────────────────────────────────

export interface PushSample {
  slot: number
  /** Encoded PNG payload size in bytes. */
  bytes: number
  /** ms to build the SDK JSON (Uint8Array → number[]) for this payload. */
  serMs: number
  /** ms for the full updateImageRawData round-trip (incl. host + BLE). */
  totalMs: number
}

type Listener = (s: PushSample) => void
const listeners = new Set<Listener>()

/** Emit a sample: logs to console (for remote devtools) and fans out to the UI. */
export function recordPush(s: PushSample): void {
  const net = Math.max(0, s.totalMs - s.serMs)
  // eslint-disable-next-line no-console
  console.log(
    `[g2perf] slot=${s.slot} ${(s.bytes / 1024).toFixed(1)}KB ` +
      `ser=${s.serMs.toFixed(0)}ms net=${net.toFixed(0)}ms total=${s.totalMs.toFixed(0)}ms`,
  )
  for (const l of listeners) {
    try {
      l(s)
    } catch {
      /* a listener throwing must not break the push path */
    }
  }
}

/** Subscribe to push samples. Returns an unsubscribe fn. */
export function onPush(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
