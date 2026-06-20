// ─────────────────────────────────────────────────────────────────────────
// App entry — mounts the phone-WebView UI and drives the glasses.
//
// Two glasses modes, both behind the `src/glasses/` adapter:
//   • Menu mode (library / file screens): a native TEXT page mirrors the current
//     screen (library hint / file title) — short prose the native path handles.
//   • Reading mode (Iteration 3): the surface switches to the 4-tile IMAGE
//     layout and the reader pushes dense-math page bitmaps; menu text is cleared.
//
// The reader talks to the glasses only through the `GlassesControl` interface
// implemented here, so the UI never imports the SDK. Glasses wiring is
// best-effort: with no bridge (plain desktop browser) every control is a no-op
// and the phone UI (incl. the 4-bit page preview) still runs.
// ─────────────────────────────────────────────────────────────────────────

import { mountApp, type ScreenInfo } from './ui/library'
import type { GlassesControl } from './ui/prompter'
import type { Tile } from './render/slice'
import { GlassesAdapter, layoutTile2x2 } from './glasses'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('#app mount point missing')

const glasses = new GlassesAdapter()
let glassesReady = false
let pending: ScreenInfo | null = null
let imageMode = false

function glassText(info: ScreenInfo): string {
  if (info.kind === 'library') {
    return `G2 Math Reader\n\n${info.count} файлов в библиотеке.\nВыберите файл на телефоне.`
  }
  if (info.kind === 'file') {
    return `${info.title}\n\nНажмите «Читать на очках»\nна телефоне.`
  }
  return '' // reader mode is image-driven; no menu text
}

// Mirror menu screens as native text. Reader mode is driven by the control below
// (images), so skip it — and skip while the surface is in image layout.
function mirror(info: ScreenInfo) {
  pending = info
  if (!glassesReady || info.kind === 'reader' || imageMode) return
  void glasses.setMessage(glassText(info)).catch(() => {})
}

// GlassesControl implementation handed to the reader screen.
const control: GlassesControl = {
  get available() {
    return glassesReady
  },
  async enterReading() {
    if (!glassesReady) return
    await glasses.setLayout(layoutTile2x2())
    imageMode = true
    await glasses.setMessage(' ').catch(() => {}) // clear any menu text behind the tiles
  },
  async showPage(tiles: Tile[]) {
    if (!glassesReady) return
    // Serial pushes (the adapter queues them); one full-surface page = 4 tiles.
    for (const tile of tiles) await glasses.sendImage(tile.slot.id, tile.bytes)
  },
  async exitReading() {
    if (!glassesReady) return
    await glasses.setLayout([]) // back to the text-only menu page
    imageMode = false
    if (pending) await glasses.setMessage(glassText(pending)).catch(() => {})
  },
  async setStatus(text: string) {
    if (!glassesReady) return
    await glasses.setStatus(text).catch(() => {})
  },
}

mountApp(root, { onScreenChange: mirror, glasses: control })

// Bring up the glasses page in the background; flush whatever screen is current.
void (async () => {
  try {
    await glasses.connect()
    await glasses.setLayout([]) // text-only page: message + status + event layer
    glassesReady = true
    await glasses.setStatus('G2 Math Reader · итерация 3')
    if (pending) mirror(pending)
  } catch (err) {
    console.warn('glasses unavailable — phone-only mode:', err)
  }
})()
