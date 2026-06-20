# Even G2 Math Reader

A **teleprompter-style reading app for [Even Realities G2](https://www.evenrealities.com) smart
glasses** that displays **dense mathematical formulas** (LaTeX-grade: fractions, sums, subscripts,
Greek, matrices) interleaved with prose. Load a library of files, pick one, and read it with
**autoscroll** at an adjustable speed.

> **Status:** research complete, no code yet. See [`docs/`](./docs) and [`CLAUDE.md`](./CLAUDE.md).

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

## Validate first (hardware spike)

Before building, confirm on real hardware: (1) SDK access to TouchPad/R1 input, (2) the image
API's accepted dimensions/format, (3) payload chunking behavior, (4) whether the full 576×288
surface is usable. Details in [`CLAUDE.md`](./CLAUDE.md).
