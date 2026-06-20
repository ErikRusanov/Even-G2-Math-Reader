# App Architecture — Math Teleprompter for Even G2

Proposed design for **our** app. Grounded in the research; assumptions are flagged. This is a
v1 plan, not final — the [hardware spike](./02-math-rendering-pipeline.md#hardware-spike-do-this-before-committing-to-the-design)
resolves the open questions first.

## Product spec (from the user)

- Load **~20 files** (a library) on the phone.
- **Select a file**, then enter a **reading/teleprompter mode**.
- **Autoscroll** with **adjustable speed**, ideally controllable **on the glasses**.
- Display **lots of dense math** that scrolls automatically.
- Example content: numerical-methods lecture notes (`cm/main-compact.pdf`) — heavy LaTeX + Cyrillic.

## Tech stack — `decided`

- **Vite + TypeScript**, scaffolded from `even-realities/evenhub-templates`.
- **`@evenrealities/even_hub_sdk`** — glasses comms.
- **`@evenrealities/evenhub-cli`** — auth + QR sideload deploy.
- **`@evenrealities/evenhub-simulator`** — local dev at 576×288 monochrome.
- **KaTeX** + `markdown-it` (+ `markdown-it-katex`) — parse & render math.
- Plain Canvas 2D for rasterize + dither (no heavy deps).

> The app runs in the **phone WebView**; the glasses are the display. All rendering, caching,
> and scroll timing happen **on the phone**.

## File format — proposed: **Markdown + LaTeX (`.md`)**

Chosen because it's natural for the source material, human-editable, and trivially parseable.

````markdown
---
title: Билет 25. Метод отражений
id: cm-25
---

Матрица Хаусхолдера: $U = I - 2ww^T$, где $\|w\|_2 = 1$.

$$
U_k = \begin{pmatrix} I_{k-1} & 0 \\ 0 & U'_k \end{pmatrix}
$$
````

- `$…$` inline math, `$$…$$` display math, prose in between.
- A "library" = a folder of these files in the app's `public/` (or imported by the user later).
- Frontmatter (`title`, `id`) feeds the selection menu.

## Screens / state machine

```
┌─────────────┐  select file   ┌──────────────┐  start   ┌───────────────┐
│  Library    │ ─────────────▶ │  File / Prep │ ───────▶ │  Teleprompter │
│  (20 files) │ ◀───────────── │ (settings)   │ ◀─────── │  (autoscroll) │
└─────────────┘     back        └──────────────┘   stop   └───────────────┘
```

1. **Library** — list of files (from frontmatter titles). Phone UI.
2. **File / Settings** — pick scroll mode + speed (WPM or sec/page), font scale. Pre-renders the
   whole file to cached strips here (progress bar).
3. **Teleprompter** — streams page/strip images to the glasses; autoscroll on a timer; pause/
   resume; speed up/down.

## Autoscroll design

- **Engine:** `setInterval` (or `requestAnimationFrame` accumulator) in the WebView advancing the
  current strip index; push the strip image via the SDK on each step.
- **Speed setting:** slider in the phone UI (e.g. **2–30 sec/page**, or WPM mapped to lines).
  Persist per-file.
- **On-glasses control (pending open question #1):**
  - *If* the SDK exposes TouchPad/R1 events → map **tap = pause/resume**, **swipe/long-press =
    speed ±**, mirroring the native teleprompter UX.
  - *If not* → speed is set from the phone before/while reading; document the limitation.

## Rendering & caching

- On file open: parse → render full ribbon → slice → quantize/dither → **cache strips by content
  hash** (in-memory; optionally `IndexedDB` to survive reloads).
- Pre-render is **eager** (whole file) so scrolling never stalls. 20 files are loaded lazily —
  only the opened file is rendered.

## Module layout (proposed)

```
src/
  glasses/        # even_hub_sdk wrapper: connect, sendImage, input events
  library/        # load .md files, parse frontmatter, list
  render/         # markdown+katex → canvas → 4-bit grayscale strips (+ dither)
  cache/          # hash-keyed strip cache
  teleprompter/   # scroll engine, speed control, page state
  ui/             # library list, settings, prompter view (phone WebView)
content/          # the ~20 .md files (or public/content)
```

## Risks → mitigations

| Risk | Mitigation |
|---|---|
| Image API smaller/different than assumed (200×100?) | Hardware spike first; tiling fallback; hybrid text+image mode |
| No SDK access to TouchPad/R1 | Phone-side speed control as baseline |
| Math illegible at 4-bit / small size | Render large + scroll; dither; legibility test on real glasses |
| SDK v0.0.x churn | Pin versions; wrap SDK behind `src/glasses/` adapter |
| BLE/protocol RE facts wrong for current firmware | Stay on official SDK for v1; treat direct-BLE as research-only |

## Milestones

1. **Spike** — scaffold template, render one formula → bitmap → glasses; answer open questions.
2. **Library + selection** — load 20 `.md`, list, open.
3. **Static render** — show a file as paged images on the glasses (manual paging).
4. **Autoscroll** — timer + phone-side speed control.
5. **On-glasses control** — wire TouchPad/R1 if available.
6. **Polish** — dithering/legibility tuning, caching, persistence.

See [`01-research-findings.md`](./01-research-findings.md) for evidence and
[`02-math-rendering-pipeline.md`](./02-math-rendering-pipeline.md) for the rendering detail.
