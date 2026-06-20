# CLAUDE.md — Even G2 Math Reader

## What this is

A **teleprompter-style reading app for Even Realities G2 smart glasses** that displays **dense
mathematical formulas** (LaTeX-grade: fractions, sums, subscripts, Greek, matrices) interleaved
with prose. The user loads a **library of ~20 files**, selects one, and reads it with
**autoscroll** at an **adjustable speed** — ideally controllable from the glasses themselves.

Example target content: numerical-methods lecture notes (`../cm/main-compact.pdf`) — heavy LaTeX
+ Cyrillic text.

## Status

- **2026-06-20:** Research complete (see `docs/`).
- **2026-06-20 — Iteration 0 DONE (incl. eyes-on-glass on real G2):** Vite+TS scaffold,
  `src/glasses/` SDK adapter (image push + input + layout/tiling), 3 probe images, spike harness
  (`src/main.ts`). 4 blocking questions resolved (SDK types + `image` template): image API = send
  encoded PNG/JPEG per container (≤288×144, ≤4 tiled → full 576×288), host does 4-bit; chunking
  transparent but sends serial; **input (touchpad L/R + R1 ring) available** via `onEvenHubEvent`.
  **Hardware-confirmed:** math reads perfectly at 4-bit; **target glyph scale = `formula-small`
  (~220×80 container)**, `formula-large` (288×144) too big; full 576×288 via 4 tiles works **but is
  very slow** (4× serial BLE pushes) → **never repaint the full surface per scroll frame**. Ran via
  Developer Mode + `evenhub qr` → Even Hub tab → Scan QR (no token; **not** Even Terminal).
- **2026-06-20 — Iteration 1 DONE (render pipeline):** `src/render/` turns LaTeX → dithered PNG.
  **Engine switched KaTeX → MathJax** (`mathjax-full` + `liteAdaptor`, SVG path output): KaTeX's
  HTML can only rasterize via SVG `<foreignObject>`, which **taints the canvas on WebKit** and
  breaks `getImageData`/`toBlob` — the pipeline needs both. MathJax SVG never taints. Pipeline:
  `texToSvg` → `rasterizeSvg` (black-on-white) → `ditherTo4bit` (invert → 16-level Floyd–Steinberg
  → white-on-black) → `encodePng`, fit to one ≤288×144 container so the host never resizes/re-dithers.
  **Calibrated default `pxPerEx = 8` (ideal), confirmed eyes-on-glass (2026-06-20)** → reference
  series formula = ~145×51 px (well under `formula-small`, leaving generous vertical room for
  scroll); every sample reads cleanly. `src/main.ts` is a calibration harness (sweep `{6,7,8,9,10}`
  × 5 dense formulas, emulated bright-green preview on the phone). Below ~6 the sub/superscript tier
  starts to blur.
- **2026-06-20 — Iteration 2 DONE (library + file selection):** `src/library/` loads the content
  set and the app gets its real shell. `frontmatter.ts` (tiny `---` block splitter, no YAML dep) +
  `load.ts` (Vite `import.meta.glob('/content/*.md', '?raw', eager)` → bundled offline, no fetch) →
  `LibraryEntry[]` sorted by `id` (natural sort). `src/ui/library.ts` = two phone-WebView screens
  with a trivial router: **Library** (files by `title`, math-count + prose snippet) → **File**
  (frontmatter + body rendered as a readable document: prose via `markdown-it`, **all** math —
  inline `$…$` AND display `$$…$$` — to crisp MathJax SVG via `texToInlineSvg` (a 2nd MathJax doc
  with `fontCache:'none'` so many equations share one page without `<use>`-id collisions). This is a
  human PHONE preview, deliberately sharp/scalable — NOT the 4-bit dithered glasses output, which is
  Iter 3). `main.ts`
  now just mounts the app (Iter-1 calibration harness lives in git history). **Format confirmed on
  real `cm` content:** 3 faithful files in `content/` (`bilet01/09/25.md`, LaTeX + Cyrillic) parse
  clean (frontmatter + 1/5/5 display + 35/42/54 inline math, dollars balanced) and every display
  formula renders error-free. Added **MathJax `macros`** map (mirrors `preamble-compact.tex`:
  `\R \eps \norm \scal \sign \diag \le …`) so `.md` keeps source LaTeX verbatim. Added deps
  `markdown-it` + `@types/markdown-it`. **Glasses are NOT blank in the menu:** an Even Hub app only
  shows on-glass once it creates a startup page + writes a container, so the adapter gained a
  full-surface **`message`** text region (id 102, above the status line) + `setMessage()`, and
  `main.ts` connects best-effort, builds a text-only page (`setLayout([])`), and mirrors the current
  screen (library hint / file title) into it — menus ride the native text path; dense-math IMAGE
  paging is Iter 3 (which overlays image slots on the `message` region and clears it).
- **Next: Iteration 3** — static paged render to the glasses (parse → ribbon → slice → cache → push).

## The one thing to understand

The glasses are a **576×288 px monochrome-green (4-bit grayscale) display + input device**. Apps
are **web apps (HTML/CSS/TypeScript) that run in the Even Hub companion phone app's WebView** —
**not** on the glasses. The native text path is capped at **~25 chars/line**, so **dense math
cannot be shown as text**. Math must be **pre-rendered to grayscale bitmaps (MathJax SVG → canvas →
4-bit dithered image)** on the phone and pushed to the glasses as **images**, paged/scrolled like
a teleprompter.

## Tech stack (decided)

- **Vite + TypeScript**, scaffolded from `even-realities/evenhub-templates`
- `@evenrealities/even_hub_sdk` (glasses comms) · `@evenrealities/evenhub-cli` (auth + QR
  sideload deploy) · `@evenrealities/evenhub-simulator` (local dev)
- **MathJax** (`mathjax-full`, SVG path output — chosen over KaTeX in Iter. 1 to avoid the
  `<foreignObject>` canvas-taint that breaks pixel read-back on WebKit) + `markdown-it` (math
  parse/render) · Canvas 2D (rasterize + Floyd–Steinberg dither)
- File format: **Markdown + LaTeX (`.md`)** with `$…$` / `$$…$$` and `title`/`id` frontmatter

## Deploy

Web app → authenticate with `evenhub-cli` → **QR sideload** to the Even Hub phone app. Use
`evenhub-simulator` for local iteration before touching hardware. Official docs:
https://hub.evenrealities.com/docs

## VALIDATE FIRST — ✅ RESOLVED in Iteration 0 (details in `docs/01` "Open questions — RESOLVED")

1. **TouchPad / R1 input → YES.** `onEvenHubEvent` delivers tap/double-tap/scroll from glasses
   touchpads (L/R) and the R1 ring; needs a text container with `isEventCapture: 1` to capture.
2. **Image API → send encoded PNG/JPEG bytes** per image container (≤288×144); host decodes +
   converts to 4-bit. Images are their own containers — they **bypass** the 10-line teleprompter.
   (The "~200×100" report was REFUTED as a limit — it was just the template's chosen size.)
3. **Payload/MTU → transparent**, but `updateImageRawData` calls must be **serial**.
4. **Full 576×288 → YES via 4 tiled 288×144 image containers** (2×2); text/event layers can be
   full-surface directly.

✅ **Confirmed eyes-on-glass (2026-06-20):** math is legible at 4-bit (target scale ≈ `formula-small`
~220×80; `formula-large` 288×144 too big); 4 tiles render full-surface **but slowly** (don't repaint
the whole surface per scroll frame). Gesture→event *direction* mapping still to be nailed down when
on-glasses control is wired (Iteration 5).

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
