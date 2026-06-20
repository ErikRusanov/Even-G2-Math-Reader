# Even G2 Math Reader

A **teleprompter-style reading app for [Even Realities G2](https://www.evenrealities.com) smart
glasses** that displays **dense mathematical formulas** (LaTeX-grade: fractions, sums, subscripts,
Greek, matrices) interleaved with prose. Load a library of files, pick one, and read it with
**autoscroll** at an adjustable speed.

> **Status:** Iteration 0 (hardware spike) scaffolded — Vite+TS app, `src/glasses/` SDK adapter,
> probe images, spike harness. The 4 blocking API questions are resolved from the official SDK;
> on-glass confirmation is the remaining step. See [`docs/`](./docs) and [`CLAUDE.md`](./CLAUDE.md).

## The core idea

The G2 is a **576×288 px monochrome-green (4-bit grayscale) display + input device**. Apps are
**web apps (HTML/CSS/TypeScript)** that run in the **Even Hub companion phone app's WebView** — not
on the glasses. The native text path caps lines at **~25 characters**, so dense math **cannot be
shown as text**. Instead, math is **pre-rendered to grayscale bitmaps** (KaTeX → canvas → 4-bit
dithered image) on the phone and pushed to the glasses as **images**, scrolled like a teleprompter.

## Planned stack

- **Vite + TypeScript** (scaffold: [`even-realities/evenhub-templates`](https://github.com/even-realities/evenhub-templates))
- `@evenrealities/even_hub_sdk` · `@evenrealities/evenhub-cli` · `@evenrealities/evenhub-simulator`
- **KaTeX** + `markdown-it` for math; Canvas 2D for rasterize + Floyd–Steinberg dither
- Content format: **Markdown + LaTeX (`.md`)** with `$…$` / `$$…$$`

## Features (target)

- 📚 Library of ~20 loadable files, select to read
- ▶️ Autoscroll with adjustable speed (phone UI; on-glasses control pending SDK input access)
- 🧮 Faithful rendering of LaTeX-grade math on a monochrome 4-bit display

## Docs

| File | Contents |
|---|---|
| [`docs/01-research-findings.md`](./docs/01-research-findings.md) | Verified facts: SDK, display, BLE, scroll — with confidence levels |
| [`docs/02-math-rendering-pipeline.md`](./docs/02-math-rendering-pipeline.md) | The core challenge: LaTeX → 4-bit bitmap pipeline |
| [`docs/03-app-architecture.md`](./docs/03-app-architecture.md) | App design, modules, file format, milestones, risks |
| [`docs/04-sources.md`](./docs/04-sources.md) | Full citation list + verification log |

## Run the Iteration 0 spike

```bash
npm install
npm run gen:test-images   # builds 3 probe PNGs into public/test/
npm run dev               # Vite dev server on http://localhost:5173
npm run simulate          # opens evenhub-simulator pointed at the dev server
```

On real glasses: authenticate with `evenhub-cli`, `npm run pack`, then **QR-sideload** to the Even
Hub phone app (official docs: https://hub.evenrealities.com/docs).

The spike cycles three probes — **tap** = next, **double-tap** = exit, **scroll** = logged. Every
gesture and image send-result is logged on the phone panel *and* the glasses status line, so the
hardware answers can be read straight off the screen:

| Probe | What it checks |
|---|---|
| `formula-large` (288×144) | Is dense math legible at 4-bit? |
| `formula-small` (220×80) | How small can sub/superscripts go? |
| `checker` (2×2 tiles) | Does image content fill the full 576×288 surface, edge to edge? |

## Validated (Iteration 0)

The 4 blocking questions are **resolved** from `@evenrealities/even_hub_sdk@0.0.10` types + the
official `image` template (full detail in [`docs/01`](./docs/01-research-findings.md) and
[`CLAUDE.md`](./CLAUDE.md)): (1) **touchpad + R1 input is available** via `onEvenHubEvent`;
(2) image API = **send encoded PNG/JPEG** per container (≤288×144), host does 4-bit conversion,
bypassing the teleprompter; (3) chunking is **transparent** but sends must be **serial**;
(4) the **full 576×288 surface is reachable** by tiling up to 4 image containers. The remaining
*eyes-on-glass* checks (legibility, edge-to-edge tiling, gesture mapping) are what the spike above
confirms on hardware.
