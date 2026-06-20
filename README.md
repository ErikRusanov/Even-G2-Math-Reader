# Even G2 Math Reader

A **teleprompter-style reading app for [Even Realities G2](https://www.evenrealities.com) smart
glasses** that displays **dense mathematical formulas** (LaTeX-grade: fractions, sums, subscripts,
Greek, matrices) interleaved with prose. Import a library of files, pick one, and read it with
**autoscroll** at an adjustable speed — drivable from the glasses themselves.

> **Status:** working MVP (Iterations 0→7), v1.1.0. The full flow — **library → file → read** —
> runs on real G2 hardware and is controllable from the glasses' TouchPad / R1 ring. Remaining work
> is eyes-on-glass polish (legibility tuning, gesture-direction confirmation). See
> [`docs/`](./docs) and [`CLAUDE.md`](./CLAUDE.md) for the full iteration log.

## The core idea

The G2 is a **576×288 px monochrome-green (4-bit grayscale) display + input device**. Apps are
**web apps (HTML/CSS/TypeScript)** that run in the **Even Hub companion phone app's WebView** — not
on the glasses. The native text path caps lines at **~25 characters**, so dense math **cannot be
shown as text**. Instead, math is **pre-rendered to grayscale bitmaps** (MathJax SVG → canvas →
4-bit Floyd–Steinberg dither → PNG) on the phone and pushed to the glasses as **images**, paged and
scrolled like a teleprompter.

## How it works

1. **Import** `.md` (or `.tex`, auto-converted) files into a library persisted in the phone's
   native key-value store (survives app restarts).
2. **Render** each file's prose + `$…$` / `$$…$$` math through a hand-rolled Canvas-2D typesetter
   into **576×144** page bitmaps, dithered once to 4-bit then sliced into image tiles (cached by
   content hash, so re-opening is instant).
3. **Read** page-by-page with autoscroll: the engine shows a page (a serial 2-tile BLE push),
   waits the per-page dwell, then advances — so slow BLE never eats reading time and pushes never
   pile up. Speed persists per file.
4. **Control** from the glasses: **swipe ↑/↓ = page**, **tap = play/pause**, **double-tap = exit**.
   Library navigation and file selection work the same way, so the whole flow is hands-free.

## Stack

- **Vite + TypeScript** (scaffold: [`even-realities/evenhub-templates`](https://github.com/even-realities/evenhub-templates))
- `@evenrealities/even_hub_sdk` · `@evenrealities/evenhub-cli` · `@evenrealities/evenhub-simulator`
- **MathJax** (`mathjax-full`, SVG path output — chosen over KaTeX to avoid the `<foreignObject>`
  canvas-taint that breaks pixel read-back on WebKit) + `markdown-it`; Canvas 2D for rasterize +
  Floyd–Steinberg dither
- Content format: **Markdown + LaTeX (`.md`)** with `$…$` / `$$…$$` and `title`/`id` frontmatter

## Source layout

| Module | Responsibility |
|---|---|
| `src/glasses/` | SDK adapter — image push, text, input gestures, native KV storage (SDK is v0.0.x, kept behind one boundary) |
| `src/render/` | LaTeX → MathJax SVG → canvas → 4-bit dither → PNG; the Canvas-2D document typesetter and page slicer |
| `src/library/` | Load / import / persist the file set; `.tex` → `.md` conversion |
| `src/cache/` | Content-hashed page-render memoization |
| `src/teleprompter/` | Pagination, scroll engine, speed model, gesture→intent map |
| `src/ui/` | Library, file, and reader screens (phone WebView) + on-glass menu mirroring |

## Run

```bash
npm install
npm run dev          # Vite dev server on http://localhost:5173
npm run simulate     # evenhub-simulator pointed at the dev server
npm run build        # tsc --noEmit + vite build
```

On real glasses: authenticate with `evenhub-cli`, then **QR-sideload** to the Even Hub phone app:

```bash
npm run pack         # build + evenhub pack → out.ehpk
```

Official docs: https://hub.evenrealities.com/docs.

> **Content is not bundled** — `content/` is git-ignored and files are imported at runtime. Convert
> LaTeX lecture notes to the app format with `node scripts/tex2md.mjs <ticket.tex> content/` (the
> same converter the phone-import path uses).

## Docs

| File | Contents |
|---|---|
| [`docs/01-research-findings.md`](./docs/01-research-findings.md) | Verified facts: SDK, display, BLE, image-push perf — with confidence levels |
| [`docs/02-math-rendering-pipeline.md`](./docs/02-math-rendering-pipeline.md) | The core challenge: LaTeX → 4-bit bitmap pipeline |
| [`docs/03-app-architecture.md`](./docs/03-app-architecture.md) | App design, modules, file format, milestones, risks |
| [`docs/04-sources.md`](./docs/04-sources.md) | Full citation list + verification log |
