// ─────────────────────────────────────────────────────────────────────────
// App entry — mounts the phone-WebView UI and mirrors its state onto the
// glasses as native text.
//
// Iteration 2 is a phone-driven menu, but the glasses must not be blank: an
// Even Hub app only appears on-glass once it creates a startup page and writes
// to a container. So on launch we build a text-only page (no image slots yet)
// and reflect the current screen — the library hint, or the opened file's
// title — into the adapter's main text region. Menus/short prose ride the
// native text path; dense-math IMAGE paging + scrolling is Iteration 3.
//
// Glasses wiring is best-effort: if no bridge is present (e.g. a plain desktop
// browser), the phone UI still runs. The Iteration-1 render-calibration harness
// that previously lived here is in git history.
// ─────────────────────────────────────────────────────────────────────────

import { mountApp, type ScreenInfo } from './ui/library'
import { GlassesAdapter } from './glasses'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('#app mount point missing')

const glasses = new GlassesAdapter()
let glassesReady = false
let pending: ScreenInfo | null = null

function glassText(info: ScreenInfo): string {
  if (info.kind === 'library') {
    return `G2 Math Reader\n\n${info.count} файлов в библиотеке.\nВыберите файл на телефоне.`
  }
  return `${info.title}\n\nЧтение на очках —\nитерация 3.`
}

function mirror(info: ScreenInfo) {
  pending = info
  if (glassesReady) void glasses.setMessage(glassText(info)).catch(() => {})
}

mountApp(root, { onScreenChange: mirror })

// Bring up the glasses page in the background; flush whatever screen is current.
void (async () => {
  try {
    await glasses.connect()
    await glasses.setLayout([]) // text-only page: message + status + event layer
    glassesReady = true
    await glasses.setStatus('G2 Math Reader · итерация 2')
    if (pending) await glasses.setMessage(glassText(pending))
  } catch (err) {
    console.warn('glasses unavailable — phone-only mode:', err)
  }
})()
