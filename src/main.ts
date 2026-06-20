// ─────────────────────────────────────────────────────────────────────────
// Iteration 1 — LaTeX → 4-bit render-pipeline calibration harness.
//
// Renders a set of dense formulas (fraction, Σ with limits, sub/superscript
// stacks, a 3×3 matrix, a norm with √) at a few glyph scales (pxPerEx), pushes
// each to the glasses, and mirrors the exact bytes-being-sent as an emulated
// bright-green-on-black preview on the phone — so legibility can be judged with
// AND without the glasses on.
//
//   tap / Next     → next (formula × scale) combo
//   double-tap     → exit on the glasses
//   ← / → keys     → prev / next (desktop + simulator, no glasses needed)
//
// Goal: find the smallest pxPerEx at which the fraction bar, Σ, and the
// sub/superscript tier stay readable. Record it in docs/02.
// ─────────────────────────────────────────────────────────────────────────

import { GlassesAdapter, layoutSingle, type InputEvent } from './glasses'
import { renderFormula } from './render'

const SAMPLES: Array<{ name: string; latex: string }> = [
  { name: 'series + fraction', latex: 'f(x)=\\sum_{i=1}^{n}\\frac{a_i\\,x^i}{1-x^2}' },
  { name: 'nested sub/superscript', latex: 'a^{(k-1)}_{k,k}=\\frac{\\partial^2 f}{\\partial x_i\\,\\partial x_j}' },
  { name: 'norm + sqrt', latex: '\\lVert x\\rVert_2=\\sqrt{\\sum_{i=1}^{n} x_i^{2}}' },
  { name: 'Householder', latex: 'U = I - 2\\,\\frac{w\\,w^{\\mathsf T}}{w^{\\mathsf T} w}' },
  { name: '3×3 matrix', latex: 'A=\\begin{pmatrix} a_{11} & a_{12} & a_{13}\\\\ a_{21} & a_{22} & a_{23}\\\\ a_{31} & a_{32} & a_{33} \\end{pmatrix}' },
]

/** Glyph-scale sweep — px per math ex. 10 is the confirmed-legible default;
 *  probe BELOW it to find how far math can shrink before sub/superscripts break. */
const SCALES = [6, 7, 8, 9, 10]

interface Combo {
  sample: (typeof SAMPLES)[number]
  pxPerEx: number
}
const COMBOS: Combo[] = SAMPLES.flatMap(sample => SCALES.map(pxPerEx => ({ sample, pxPerEx })))

const IMG_SLOT = 1
const glasses = new GlassesAdapter()
let index = 0
let switching = false

// ── Phone panel ─────────────────────────────────────────────────────────────

const log: string[] = []
function logLine(msg: string) {
  log.unshift(msg)
  if (log.length > 10) log.pop()
  renderPanel()
}

let info = { name: '—', latex: '', pxPerEx: 0, w: 0, h: 0, result: '' }

function renderPanel() {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <main style="margin:auto;padding:20px;max-width:680px;width:100%;box-sizing:border-box;font-family:system-ui,sans-serif;">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 4px;">G2 Math Reader — Iteration 1 render calibration</h1>
      <p style="color:#919191;font-size:13px;margin:0 0 14px;">
        Glasses: <b>tap</b> = next · <b>double-tap</b> = exit. Desktop: <b>←/→</b> keys or buttons.
      </p>
      <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:12px 14px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <div style="font-size:15px;color:#9be29b;font-weight:600;">${escapeHtml(info.name)}</div>
          <div style="font-size:13px;color:#9be29b;">pxPerEx ${info.pxPerEx} · ${info.w}×${info.h}px → ${escapeHtml(info.result)}</div>
        </div>
        <code style="display:block;font:12px/1.5 ui-monospace,Menlo,monospace;color:#cfcfcf;margin-top:6px;white-space:pre-wrap;">${escapeHtml(info.latex)}</code>
      </div>
      <div style="font-size:12px;color:#919191;margin-bottom:6px;">Emulated glasses preview (bright-green on black, ×3, what is actually sent)</div>
      <div style="background:#000;border:1px solid #333;border-radius:8px;padding:14px;margin-bottom:12px;min-height:120px;display:flex;align-items:center;justify-content:center;">
        <canvas id="preview" style="image-rendering:pixelated;"></canvas>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button id="prev" style="flex:1;padding:10px;background:#2a2a2a;color:#e5e5e5;border:1px solid #444;border-radius:6px;font-size:14px;">← Prev</button>
        <button id="next" style="flex:1;padding:10px;background:#2a2a2a;color:#e5e5e5;border:1px solid #444;border-radius:6px;font-size:14px;">Next →</button>
      </div>
      <pre style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:12px 14px;margin:0;
                  font:12px/1.5 ui-monospace,Menlo,monospace;color:#E5E5E5;white-space:pre-wrap;
                  min-height:120px;">${log.map(escapeHtml).join('\n') || '…waiting for bridge…'}</pre>
    </main>
  `
  document.querySelector('#prev')!.addEventListener('click', () => step(-1))
  document.querySelector('#next')!.addEventListener('click', () => step(1))
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
}

/** Draw the sent PNG bytes onto the preview canvas, tinted bright-green-on-black. */
async function drawPreview(bytes: Uint8Array, w: number, h: number) {
  const canvas = document.querySelector<HTMLCanvasElement>('#preview')
  if (!canvas) return
  const scale = 3
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }))
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  // Multiply by green: grayscale value survives in the green channel only.
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = '#00ff66'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'source-over'
}

// ── Driver ──────────────────────────────────────────────────────────────────

async function show(i: number) {
  if (switching) return
  switching = true
  const { sample, pxPerEx } = COMBOS[i]
  try {
    const { bytes, width, height } = await renderFormula(sample.latex, { pxPerEx })
    await glasses.setLayout(layoutSingle(width, height, IMG_SLOT))
    const result = await glasses.sendImage(IMG_SLOT, bytes)
    info = { name: sample.name, latex: sample.latex, pxPerEx, w: width, h: height, result: String(result) }
    logLine(`${i + 1}/${COMBOS.length} ${sample.name} @${pxPerEx} → ${width}×${height} ${bytes.length}B → ${result}`)
    await glasses.setStatus(`${sample.name} @${pxPerEx} ${width}×${height} · tap=next`)
    await drawPreview(bytes, width, height)
  } catch (err) {
    logLine(`render ERROR: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    switching = false
  }
}

function step(delta: number) {
  index = (index + delta + COMBOS.length) % COMBOS.length
  void show(index)
}

function onInput(event: InputEvent) {
  logLine(`input: ${event.type} · source=${event.source}`)
  if (event.type === 'tap') step(1)
  else if (event.type === 'doubleTap') void glasses.shutdown(1)
}

async function main() {
  renderPanel()
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') step(1)
    else if (e.key === 'ArrowLeft') step(-1)
  })
  logLine('connecting to bridge…')
  await glasses.connect()
  logLine('bridge ready')
  glasses.onInput(onInput)
  await show(index)
}

main().catch(err => {
  logLine(`fatal: ${err instanceof Error ? err.message : String(err)}`)
  console.error(err)
})
