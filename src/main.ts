// ─────────────────────────────────────────────────────────────────────────
// Iteration 0 — "hello glasses" hardware spike.
//
// Goal: get a real image onto the G2 and answer the four blocking questions
// before any rendering pipeline exists. This harness cycles three probes and
// logs every input gesture both on the phone panel and on the glasses status
// line, so the answers can be read straight off the screen.
//
//   Probe 1  formula-large   single 288×144 slot   → math legible at 4-bit?
//   Probe 2  formula-small   single 220×80 slot    → smallest readable scale?
//   Probe 3  checker         2×2 tiles, full 576×288 → full-surface reachable?
//
//   tap        → next probe        (also: confirms tap events arrive + source)
//   scroll     → logged            (confirms scroll events arrive)
//   double-tap → exit the app
// ─────────────────────────────────────────────────────────────────────────

import {
  GlassesAdapter,
  layoutSingle,
  layoutTile2x2,
  type ImageSlot,
  type InputEvent,
} from './glasses'

interface Probe {
  name: string
  layout: () => ImageSlot[]
  images: Array<[slotId: number, file: string]>
}

const PROBES: Probe[] = [
  {
    name: 'formula-large · single 288×144',
    layout: () => layoutSingle(288, 144, 1),
    images: [[1, 'formula-large.png']],
  },
  {
    name: 'formula-small · single 220×80',
    layout: () => layoutSingle(220, 80, 1),
    images: [[1, 'formula-small.png']],
  },
  {
    name: 'checker · 2×2 tiles, full 576×288',
    layout: layoutTile2x2,
    images: [
      [1, 'checker-tile-1.png'],
      [2, 'checker-tile-2.png'],
      [3, 'checker-tile-3.png'],
      [4, 'checker-tile-4.png'],
    ],
  },
]

async function loadImageBytes(file: string): Promise<Uint8Array> {
  const url = `${import.meta.env.BASE_URL}test/${file}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${file}: ${res.status} ${res.statusText}`)
  return new Uint8Array(await res.arrayBuffer())
}

// ── Phone-side panel (the readable record of the spike) ─────────────────────

const log: string[] = []
function logLine(msg: string) {
  log.unshift(msg)
  if (log.length > 14) log.pop()
  renderPanel()
}

let panelProbe = '—'
function renderPanel() {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <main style="margin:auto;padding:20px;max-width:680px;width:100%;box-sizing:border-box;">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 4px;">G2 Math Reader — Iteration 0 spike</h1>
      <p style="color:#919191;font-size:13px;margin:0 0 14px;">
        On the glasses: <b>tap</b> = next probe · <b>double-tap</b> = exit · <b>scroll</b> = logged.
      </p>
      <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:12px 14px;margin-bottom:12px;">
        <div style="font-size:12px;color:#919191;">Active probe</div>
        <div style="font-size:15px;color:#9be29b;font-weight:600;">${panelProbe}</div>
      </div>
      <div style="font-size:12px;color:#919191;margin-bottom:6px;">Event / result log (newest first)</div>
      <pre style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:12px 14px;margin:0;
                  font:12px/1.5 ui-monospace,Menlo,monospace;color:#E5E5E5;white-space:pre-wrap;
                  min-height:240px;">${log.map(escapeHtml).join('\n') || '…waiting for bridge…'}</pre>
    </main>
  `
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
}

// ── Probe driver ────────────────────────────────────────────────────────────

const glasses = new GlassesAdapter()
let probeIndex = 0
let switching = false

async function showProbe(index: number) {
  if (switching) return
  switching = true
  const probe = PROBES[index]
  panelProbe = `${index + 1}/${PROBES.length} — ${probe.name}`
  try {
    await glasses.setLayout(probe.layout())
    for (const [slotId, file] of probe.images) {
      const bytes = await loadImageBytes(file)
      const result = await glasses.sendImage(slotId, bytes)
      logLine(`probe ${index + 1} · slot ${slotId} · ${file} (${bytes.length}B) → ${result}`)
    }
    await glasses.setStatus(`${index + 1}/${PROBES.length} ${probe.name} · tap=next dbl=exit`)
  } catch (err) {
    logLine(`probe ${index + 1} ERROR: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    switching = false
  }
}

function onInput(event: InputEvent) {
  logLine(`input: ${event.type} · source=${event.source}`)
  switch (event.type) {
    case 'tap':
      probeIndex = (probeIndex + 1) % PROBES.length
      void showProbe(probeIndex)
      break
    case 'doubleTap':
      logLine('double-tap → shutting down')
      void glasses.shutdown(1)
      break
    case 'scrollUp':
    case 'scrollDown':
      // logged above; left as a no-op probe of scroll delivery
      break
    case 'exit':
      logLine('system exit event')
      break
  }
}

async function main() {
  renderPanel()
  logLine('connecting to bridge…')
  await glasses.connect()
  logLine('bridge ready')
  glasses.onInput(onInput)
  await showProbe(probeIndex)
}

main().catch(err => {
  logLine(`fatal: ${err instanceof Error ? err.message : String(err)}`)
  console.error(err)
})
