# CLAUDE.md — Even G2 Math Reader

## What this is

A **teleprompter-style reading app for Even Realities G2 smart glasses** that displays **dense
mathematical formulas** (LaTeX-grade: fractions, sums, subscripts, Greek, matrices) interleaved
with prose. The user loads a **library of ~20 files**, selects one, and reads it with
**autoscroll** at an **adjustable speed** — ideally controllable from the glasses themselves.

Example target content: numerical-methods lecture notes (`../cm/main-compact.pdf`) — heavy LaTeX
+ Cyrillic text.

## Status

- **2026-06-20:** Research complete (see `docs/`). **No code yet.** Next step is a hardware spike.

## The one thing to understand

The glasses are a **576×288 px monochrome-green (4-bit grayscale) display + input device**. Apps
are **web apps (HTML/CSS/TypeScript) that run in the Even Hub companion phone app's WebView** —
**not** on the glasses. The native text path is capped at **~25 chars/line**, so **dense math
cannot be shown as text**. Math must be **pre-rendered to grayscale bitmaps (KaTeX → canvas →
4-bit dithered image)** on the phone and pushed to the glasses as **images**, paged/scrolled like
a teleprompter.

## Tech stack (decided)

- **Vite + TypeScript**, scaffolded from `even-realities/evenhub-templates`
- `@evenrealities/even_hub_sdk` (glasses comms) · `@evenrealities/evenhub-cli` (auth + QR
  sideload deploy) · `@evenrealities/evenhub-simulator` (local dev)
- **KaTeX** + `markdown-it` (math parse/render) · Canvas 2D (rasterize + Floyd–Steinberg dither)
- File format: **Markdown + LaTeX (`.md`)** with `$…$` / `$$…$$` and `title`/`id` frontmatter

## Deploy

Web app → authenticate with `evenhub-cli` → **QR sideload** to the Even Hub phone app. Use
`evenhub-simulator` for local iteration before touching hardware. Official docs:
https://hub.evenrealities.com/docs

## VALIDATE FIRST (blocks the design — do a hardware spike)

1. Does the SDK expose **TouchPad / R1 ring** input to third-party web apps? (on-glasses speed control)
2. **Image API**: what dimensions/format does `even_hub_sdk` accept? Does an image **bypass** the
   10-line teleprompter page structure? (community reports a ~200×100 px container — unconfirmed)
3. **Payload/MTU**: does the SDK chunk large images transparently, or must we fragment manually?
4. Can a custom app use the **full 576×288** surface, or only the narrow teleprompter column?

Resolve these before locking the rendering/scroll design.

## Docs

- `docs/01-research-findings.md` — verified facts (SDK, display, BLE, scroll), confidence levels
- `docs/02-math-rendering-pipeline.md` — the core challenge: LaTeX → 4-bit bitmap pipeline
- `docs/03-app-architecture.md` — proposed app design, modules, milestones, risks
- `docs/04-sources.md` — full citation list + verification log (confirmed vs refuted claims)

## Conventions

- Keep all glasses-SDK calls behind a `src/glasses/` adapter (SDK is v0.0.x and will churn).
- Treat reverse-engineered BLE protocol facts (`i-soxi/even-g2-protocol`, `radioegor146/even-utils`)
  as **research-only**; v1 uses the **official SDK**, not direct BLE.
- Render math **large and scroll** rather than shrinking to fit — vertical space is free on a
  teleprompter; legibility of sub/superscripts at 4-bit is the binding constraint.
