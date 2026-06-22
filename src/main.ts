// ─────────────────────────────────────────────────────────────────────────
// App entry — mounts the phone-WebView UI and drives the glasses.
//
// Two glasses modes, both behind the `src/glasses/` adapter:
//   • Menu mode (library / file screens): a native TEXT page shows the on-glass
//     library list / file hint. Selection is driven by glasses gestures (the UI
//     owns this — see ui/library.ts) and mirrored as text via setMessage.
//   • Reading mode (Iteration 3): the surface switches to the 2-tile IMAGE
//     layout and the reader pushes dense-math page bitmaps; menu text is dropped.
//
// The UI talks to the glasses only through the `GlassesControl` interface
// implemented here, so it never imports the SDK. Glasses wiring is best-effort:
// with no bridge (plain desktop browser) every control is a no-op and the phone
// UI (incl. the 4-bit page preview) still runs.
// ─────────────────────────────────────────────────────────────────────────

import { mountApp } from './ui/library'
import { setStorageBackend } from './library/store'
import { initPageStore } from './cache/page-store'
import type { GlassesControl } from './ui/prompter'
import type { Tile } from './render/slice'
import { GlassesAdapter, layoutTile1x2, type InputEvent } from './glasses'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('#app mount point missing')

const glasses = new GlassesAdapter()
let glassesReady = false
let imageMode = false

// Input fan-out: both the on-glass menu (mounted now) and the reader (mounted
// later) subscribe via control.onInput BEFORE the bridge is necessarily up. We
// collect handlers and, once connected, attach a single bridge listener that
// fans every gesture out to all of them — so a handler registered pre-connect
// still receives events. Handlers self-filter by the current screen.
const inputHandlers = new Set<(event: InputEvent) => void>()

// GlassesControl implementation handed to the UI layer.
const control: GlassesControl = {
  get available() {
    return glassesReady
  },
  async enterReading() {
    if (!glassesReady) return
    // 2-tile reading page (top half) — half the pushes. The image layout omits
    // the native message region, so no stale menu text shows in the blank bottom.
    await glasses.setLayout(layoutTile1x2())
    imageMode = true
  },
  async showPage(tiles: Tile[]) {
    if (!glassesReady) return
    // Serial pushes (the adapter queues them); one reading page = 2 tiles.
    for (const tile of tiles) await glasses.sendImage(tile.slot.id, tile.bytes)
  },
  async exitReading() {
    if (!glassesReady) return
    await glasses.setLayout([]) // back to the text-only menu page
    imageMode = false
    // The UI re-renders the menu (and re-pushes its text) via onBack → render.
  },
  async setStatus(text: string) {
    if (!glassesReady) return
    await glasses.setStatus(text).catch(() => {})
  },
  async setMessage(text: string) {
    // Menu text only — in reading mode the message container is dropped, so a
    // setMessage would have nowhere to land. The UI never calls it while reading.
    if (!glassesReady || imageMode) return
    await glasses.setMessage(text).catch(() => {})
  },
  onInput(handler) {
    inputHandlers.add(handler)
    return () => inputHandlers.delete(handler)
  },
}

const app = mountApp(root, { glasses: control })

// Bring up the glasses page in the background, then refresh the menu on-glass.
void (async () => {
  try {
    await glasses.connect()
    await glasses.setLayout([]) // text-only page: message + status + event layer
    glassesReady = true
    // Persist the imported library in the phone's NATIVE key-value store (via the
    // SDK bridge), not the WebView's IndexedDB — the latter is wiped between
    // launches in the packaged app, so files imported in one session disappeared.
    // Installing this backend before app.onGlassesReady() makes the reload below
    // read from (and future imports write to) the durable host store.
    const hostBackend = {
      async get(key: string) {
        try {
          return await glasses.getStorage(key)
        } catch {
          return null
        }
      },
      async set(key: string, value: string) {
        try {
          await glasses.setStorage(key, value)
        } catch {
          /* best-effort */
        }
      },
    }
    setStorageBackend(hostBackend)
    // Page-tile cache uses the same host KV backend. Install it here so
    // renders that happen before the bridge is up fall back to IndexedDB/memory.
    initPageStore(hostBackend)
    // One bridge subscription fans out to every registered handler (menu + reader).
    glasses.onInput(event => {
      for (const handler of inputHandlers) handler(event)
    })
    app.onGlassesReady() // paint the current menu screen now that we can push text
  } catch (err) {
    console.warn('glasses unavailable — phone-only mode:', err)
  }
})()
