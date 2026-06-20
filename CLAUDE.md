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
- **2026-06-20 — Iteration 3 DONE (static paged render to glasses):** a selected `.md` is now
  rendered to full-surface page bitmaps and read page-by-page on the glasses. New modules:
  `src/render/document.ts` (hand-rolled Canvas-2D typesetter — DOM-to-canvas is impossible because
  HTML rasterization needs `<foreignObject>`, which taints the canvas: `parseBlocks` →
  `tokenizeInline` → greedy line-wrap → paginate into **576×288 black-on-white pages**, drawing
  prose + inline `$…$` + display `$$…$$` math; inline math is baseline-aligned via the SVG's
  `vertical-align` depth, now surfaced through `texToSvg().exDepth` + `render/index.ts texToImage`),
  `src/render/slice.ts` (**dither the whole 576×288 page ONCE** so Floyd–Steinberg has no tile
  seams, then crop into the 4 `layoutTile2x2` quadrants + encode PNG per tile; also emits a
  green-tinted phone-preview data URL = the REAL 4-bit output, not Iter-2's sharp SVG),
  `src/cache/index.ts` (FNV-1a content hash + promise-memo, keyed by render-version+id+body so
  re-opening a file is instant), `src/teleprompter/pages.ts` (`paginateDocument(entry)` →
  `PagedDoc{pages:[{tiles,preview}]}`), `src/ui/prompter.ts` (reader screen: progress bar →
  manual ‹ Назад / Вперёд ›, mirrors each page on the phone). Glasses now have **two modes** behind
  the adapter: menu = native text; reading = the **4-tile IMAGE layout** — `main.ts` implements a
  `GlassesControl` (`enterReading`/`showPage`/`exitReading`) so the UI never imports the SDK, and
  switches `setLayout(layoutTile2x2())` ↔ `setLayout([])` on entering/leaving the reader. 4 tiles
  pushed **serially** per page-flip (slow but fine for manual paging; per-frame repaint is the
  Iter-4 autoscroll concern). Parser cross-checks the Iter-2 facts exactly (1/5/5 display,
  35/42/54 inline). `tsc` + `vite build` clean. **Eyes-on-glass calibration of font/scale still
  pending** (defaults in `DEFAULT_DOC_CONFIG`: fontPx 19, lineGap 9, displayPxPerEx 9, inline 8).
- **2026-06-20 — Iteration 4 DONE (autoscroll + phone speed control = the MVP):** the reader now
  auto-advances the paged document on a timer. New modules: `src/teleprompter/speed.ts` (sec/page
  model: `MIN/MAX/DEFAULT = 2/180/8` (up to 3 min/page; label switches to `m:ss` at ≥60 s),
  `clampSpeed`/`formatSpeed`, **per-file persistence** in
  `localStorage` key `g2reader:speed:<id>`), `src/teleprompter/engine.ts` (`ScrollEngine` — transport
  state only, no SDK/DOM beyond rAF), `src/ui/settings.ts` (control bar: play/pause + ‹ › step +
  speed slider, plus a live `ControlHandle` so the prompter mutates controls without re-rendering).
  **The binding design fact:** a page flip = 4 serial tile pushes the host warned is *slow* (seconds),
  so the engine's invariant is **a push never overlaps a dwell or another push** — the cycle is
  `showPage(i)` → *await the slow push* → dwell `secPerPage` s → `showPage(i+1)`; i.e. `secPerPage`
  times the PAUSE once a page is fully on-glass, NOT wall-clock per page, so slow BLE never eats
  reading time and pushes can't pile up. `showPage` is the engine's single backpressure point
  (awaited) and the only place a page is shown. Dwell uses a **rAF accumulator** (not one long
  setTimeout) → smooth phone countdown bar + live speed changes restart the countdown immediately.
  `src/ui/prompter.ts` rewritten: renders the reader shell **once**, then engine callbacks mutate
  only the page `<img>`, counter, play button, nav-disabled, and dwell bar (no per-frame innerHTML
  churn → slider keeps focus, image never flickers). Tapping the preview = play/pause (phone
  stand-in for a glasses tap). Eager pre-render (Iter-3 `paginateDocument` progress bar) already
  guarantees scroll never stalls. Phone-only (no glasses) still autoscrolls — pushes resolve as
  no-ops. `tsc` + `vite build` clean. **← working MVP (Iterations 0→4).** **Eyes-on-glass pending:**
  confirm dwell timing feels right at 4-bit and that serial 4-tile pushes keep up at the fast end
  (sec/page floor may need raising on real BLE).
- **2026-06-20 — Iteration 5 DONE (on-glasses control: TouchPad / R1):** reading is now drivable
  from the glasses themselves, not just the phone. The Iter-0 adapter already normalized raw
  protobuf events into SDK-agnostic gestures (`onInput` → `tap`/`doubleTap`/`scrollUp`/`scrollDown`/
  `exit`, with `source`), so Iter 5 is pure wiring + the gesture→intent map. New module
  `src/teleprompter/gestures.ts` (`gestureToAction`) is the **one documented place** that binds
  generic gestures to reader intent — keeps the `src/glasses/` adapter free of teleprompter concepts:
  **tap = play/pause**, **scrollUp = faster**, **scrollDown = slower**, **doubleTap / system-exit =
  leave reader**. `speed.ts` gains `stepSpeed` (coarse **multiplicative ~25%/swipe** step so one
  gesture feels equal across the whole 2…180 s/page range, not 1 s crawls at the slow end).
  `GlassesControl` gains `onInput(handler) → unsubscribe` (implemented in `main.ts` over the adapter;
  a no-op `() => {}` with no bridge, so phone control stays the baseline and desktop dev is
  unaffected). `prompter.ts` subscribes in `runReader` *after* `enterReading`, tracks the latest
  `ScrollState` (`last`) so a swipe acts on the current speed, and routes every gesture through one
  `handleGesture`. A swipe `applySpeed` moves engine + phone slider + per-file persistence + an
  **on-glass speed HUD** together (the slider's own handler only touches engine+storage since it IS
  the source). **On-glass speed HUD (`src/teleprompter/hud.ts`):** in reading mode the surface is
  fully covered by the 2×2 image tiles (all 4 image containers used) and the native status line sits
  *behind* them — a status-text speed flash is **invisible on-glass**, and there is **no spare image
  container** for a true floating overlay (4/4 used) nor sub-tile repaint (containers repaint
  whole-tile). So the HUD draws a **modal window composited onto the page**, **not** a full-surface
  repaint. **ROOT CAUSE of the on-glass slowness (researched 2026-06-20, see `docs/01` §image-perf):**
  a BLE image push is slow in proportion to the container's **pixel area + a fixed per-push
  round-trip**, and is **independent of our PNG byte size** (the Even Hub host re-encodes each
  container to a fixed bitmap before the BLE hop). Field rates: 50×50 ≈ 4 FPS, 30×30 ≈ 9 FPS, full
  576×136 ≈ 3 s → a 288×144 tile ≈ ~1.5 s. The first HUD cut repainted **both** bottom tiles serially
  (~3 s) and visibly **tore** — left tile reverted before the right one landed. Fix follows straight
  from the cause: repaint a **single** bottom tile (the bottom-left), so the update is **atomic (no
  tear)** and ~half the cost. `hudTile()` picks it; `renderSpeedHudTiles` decodes that one clean tile,
  draws a centered bordered modal (log-scaled slider, `formatSpeed` label, «быстро/медленно» ends)
  over the kept page math, re-encodes, returns **one** tile. Transient (TV-volume-bar): ~2.2 s after
  the last swipe the clean tile is restored from its **cached bytes** (`hudCleanTiles`, no re-encode),
  **guarded on the page index** so an autoscroll flip (repaints all 4 tiles) is never clobbered by a
  stale restore. **Coalesced**: while the push is in flight, more swipes only update the latest target
  speed — exactly one more push lands for that value when the BLE queue frees, so N fast swipes cost
  ~1–2 pushes, not 2N. Fired only by glasses swipes (the phone slider drags too fast to push
  per-tick). Back-button, double-tap, and app-closed-on-glasses now all funnel
  through a single idempotent `exitReader` (unsubscribe → dispose → restore menu layout → back to
  File). `tsc` +
  `vite build` clean. **Eyes-on-glass pending:** the **swipe direction → faster/slower** convention
  (swipe-up = faster) is a documented assumption isolated to one `switch` in `gestures.ts` — flip the
  two `scroll*` cases if hardware shows it inverted; also confirm the R1 ring actually emits these.
- **2026-06-20 — Perf investigation (image push), base64 workaround REVERTED:** page loads are
  brutal and **content-dependent** (bilet-01 slide 1 ≈ 11 s, the *denser* slide 2 ≈ 30 s — area-fixed
  BLE can't explain that). Suspected mechanism: `ImageRawDataUpdate` converts a `Uint8Array` payload
  into a `number[]` and JSON-serializes it across the WebView↔host bridge, so a ~40 KB dithered tile
  becomes a ~40 000-element array and high-entropy pages blow up biggest. **Tried** handing the SDK a
  **base64 string** instead (the `.d.ts` says the host accepts it): ✅ fine in the **simulator**, ❌
  **broke on real glasses — slides stopped rendering entirely** (stuck on the native menu text). The
  device firmware doesn't decode the base64 like the sim's JS host does. **Reverted** to the
  Uint8Array byte path (`Tile.bytes`, `sendImage(id, bytes)`) — the only hardware-safe one. Net: no
  speedup landed; the real lever is payload **size/entropy** (lighter dithering / cleaner image) or
  **fewer pixels** (smaller pages), both of which need eyes-on-glass. Details + open question (bridge
  array vs host PNG-decode) in `docs/01` §image-perf. `tsc` + `vite build` clean. **Decision: measure
  first.** Added a **DIAGNOSTIC timing spike** (`src/glasses/perf.ts` + instrumentation in
  `GlassesAdapter.sendImage`, live readout in `prompter.ts`): per tile it reports payload **KB**,
  **ser** (Uint8Array→number[] JSON build, timed by an explicit extra `ImageRawDataUpdate.toJson`) and
  **total** round-trip → `net ≈ total − ser` ≈ host+BLE, with a "last-4-tiles ≈ page" roll-up shown on
  the phone. If **ser** dominates → reduce payload BYTES; if **net** dominates → reduce PIXELS. NB the
  extra toJson makes the measured run slower than production — read the ser/net SPLIT, not the
  absolute. **Remove this spike once the lever is chosen.**
- **2026-06-20 — Measured + Iteration 6a (2-tile pages):** the spike settled it (numbers in `docs/01`
  §image-perf): **`ser` ≈ 0–7 ms** (bridge serialization is a non-issue — base64 was a red herring),
  **`net` is the whole cost and is uncorrelated with payload KB** (a 6.4 KB tile took 11 s, a 12.4 KB
  tile 5.5 s → smaller/cleaner PNGs won't help), and the per-tile cost is a **fixed ~3 s fresh**
  (≈12.6 s/page) that **degrades to ~7–13 s under rapid paging**. Since a 288×144 tile ≈ a full image
  in cost, it's **per-push overhead, not per-pixel** → the only lever is **fewer pushes**. Implemented
  **2-tile reading pages**: render the doc into **576×144** pages (top half) instead of 576×288, so a
  page = **2** image pushes (~6 s) not 4 (~12 s). `glasses/layoutTile1x2()` (top-row 2 slots),
  `slice.ts` infers 1×2 vs 2×2 by page height + pads the phone preview to full surface (content top,
  blank bottom = true on-glass look), `pages.ts` renders at `pageH=144, pad=10` and bumps
  `RENDER_VERSION → iter6-2tile-v1`, `main.ts enterReading` uses `layoutTile1x2`, `hud.hudTile` now
  picks lowest/left-most tile (was bottom-row-only). Tradeoff: shorter window (~3–4 lines/page) + ~2×
  more flips, each ~2× faster. Perf spike kept until the 2× is confirmed eyes-on-glass, then removed.
  `tsc` + `vite build` clean.
- **2026-06-20 — Iteration 6b (gesture remap + bottom page indicator + stale-title fix):** three
  on-glass UX fixes driven by eyes-on-glass with the 2-tile layout. **(1) Swipes now PAGE, not
  speed:** `gestures.ts` maps `scrollUp → 'next'`, `scrollDown → 'prev'` (was faster/slower);
  speed is now phone-slider-only. A manual flip routes through `engine.next()/prev()` → `goTo`,
  which keeps the current play state and **restarts the dwell** if playing — so autoscroll never
  stops, it just re-times from the page you jumped to (the user's "таймер обнуляется, но не
  перестаёт работать"). This retired the entire on-glass **speed HUD** wiring in `prompter.ts`
  (`showSpeedHud`/`restoreHud`/coalescing/`applySpeed` + the `hud`/`stepSpeed`/`clampSpeed` imports);
  `src/teleprompter/hud.ts` is now orphaned (kept on disk, tree-shaken out — restore if glass-side
  speed control ever returns). **(2) Page indicator on glass:** `showPage` sets the bottom status
  line to a clean **`N / total`** (dropped the title prefix) — visible because the 2-tile page only
  covers the top half, so the status line (y 260–288) sits in the blank bottom band. **(3) Stale
  menu title fix:** on real G2 the native **message** region kept showing the File-screen title
  (e.g. «Билет 1…») in that blank bottom band — the phone preview is pure image so it never showed
  it, and `setMessage(' ')` doesn't reliably clear (whitespace is treated as no-op). Fixed
  **structurally** in `glasses/buildContainers`: the message text container is now **omitted entirely
  whenever image slots are present** (`includeMessage = clamped.length === 0`), so reading mode has
  no region to hold stale text; `main.ts enterReading` dropped its now-pointless `setMessage(' ')`.
  Menu mode (slots `[]`) still gets the message region as before. `tsc` + `vite build` clean.
  **Eyes-on-glass pending:** confirm the swipe direction (up = next) feels right and the bottom
  «N / total» renders where expected.
- **2026-06-20 — Iteration 7 (on-glass file selection):** the whole flow is now drivable from the
  glasses, not just the phone — **library → file → read** without touching the phone. In menu mode
  the native-text **message** region (already present when there are no image slots) now shows a
  **windowed library list** with a `> ` marker on the highlighted row, and gestures navigate it:
  **swipe ↑/↓ moves the highlight, tap reads** the highlighted file — **straight into reading, no
  File-screen stop** (`select → read(...)`, per the user's "при тапе сразу запускается старт режим").
  Exiting the reader (double-tap) still lands on the File screen — its `backToFile` onBack is shared
  with the phone — where glasses **tap = «Читать»** (re-enter) and **double-tap = back to library**.
  **Autoplay on open:** the reader no longer opens paused — `prompter.ts runReader` calls
  `engine.play()` right after `engine.start()` (once the first page has landed), so opening a file
  goes straight into autoscroll with no separate «Старт» tap (`play()` no-ops on a 1-page doc or if
  disposed mid-load). The reader transport (Iters 4–6) is otherwise unchanged.
  **On-glass loader:** tapping a bilet runs `paginateDocument` (seconds) while still in menu/text
  mode, so `mountReader` now mirrors the phone's progress bar to the glasses via `setMessage`
  («<title>… Загрузка страниц… N/total», status «подготовка страниц…»), updated from the same
  `onProgress` callback; it's replaced by the first page once `enterReading` switches to the image
  layout. **Dimmer ink (brightness):** the SDK has **no brightness API** (`even_hub_sdk@0.0.10` =
  page/image/text/audio/IMU only) — the app cannot set the glasses' brightness, which is governed by
  the phone. Full-white glyphs read as too harsh, so `ditherTo4bit` gained an `inkScale` (0..1)
  applied to the post-invert luminance BEFORE quantization (so output still snaps to the 16-level
  grid → host gray-4 stays near-identity); `slice.ts` passes `INK_SCALE = 0.7` (brightest pixels →
  ~level 11/15), and `RENDER_VERSION → iter7-dim-ink-v1` rebuilds the page cache. Tune `INK_SCALE`
  eyes-on-glass (bump RENDER_VERSION on change).
  **Where the logic lives — the UI owns the on-glass menu now, not `main.ts`:** the old
  `main.ts` `glassText`/`mirror`/`ScreenInfo` text-mirror was removed; `ui/library.ts mountApp`
  gained `menuSel` state, a `renderGlasses()` (pushes `glassesLibraryText()` + a status hint via the
  new `GlassesControl.setMessage`), and a `handleMenuGesture` that self-filters by `screen.kind`
  (ignores `reader` — the prompter owns those gestures). Selection wraps modulo the list; the window
  (`WINDOW=5`) keeps the highlight centered so a 20-file library stays navigable on the ~10 native
  lines; titles truncate to ~22 chars. **One new place for the gesture map:** `teleprompter/gestures.ts`
  gained `menuGestureToAction` (`MenuAction = up|down|select|back`) beside the reader's
  `gestureToAction`, so every gesture→intent binding stays in one module (swap the two `scroll*`
  cases if hardware inverts). **Two plumbing facts that made it work:** (1) `control.onInput` in
  `main.ts` no longer subscribes the bridge per-caller — it adds handlers to a **fan-out `Set`**, and
  the bootstrap attaches **one** `glasses.onInput` after connect that dispatches to all of them; this
  fixes the ordering bug where the UI subscribes **before** the bridge is up (previously `onInput`
  returned a no-op when `!glassesReady`). Menu + reader handlers now coexist in the set and each
  self-filters. (2) `mountApp` returns an `AppHandle{ onGlassesReady() }` the bootstrap calls once
  connected, so the initial library list is painted the moment the bridge is ready (menu `setMessage`
  is a no-op before then). `GlassesControl` gained `setMessage` (guarded on `!glassesReady || imageMode`
  so it only writes the message region in menu mode); `enterReading`/`exitReading` no longer touch
  menu text (the UI re-renders on `onBack`). Phone selection (tap rows / «Читать» button) is
  untouched — both input paths drive the same `open`/`read`/`back` closures. `tsc` + `vite build`
  clean. **Eyes-on-glass pending:** confirm swipe ↑ = previous file (vs next) reads right, and that
  the `> ` marker + Cyrillic titles render legibly in the native list.
- **Next: Iteration 6** — Polish: dithering/legibility tuning on real lectures, `IndexedDB` strip
  cache (survives WebView reload), reading-position persistence per file, final `src/glasses/`
  cleanup for the current SDK version.

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
