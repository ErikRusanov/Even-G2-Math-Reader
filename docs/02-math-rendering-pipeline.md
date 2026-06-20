# Math Rendering Pipeline — the core challenge

This is the heart of the project. The source material is **LaTeX-grade 2D math interleaved with
(Cyrillic) prose** — e.g. block matrices, nested superscripts like `a^{(k-1)}_{k,k}`, norms
`‖·‖₂`, displayed equations. None of this is linearizable to a single ~25-char text line, so the
glasses' native text path is a dead end for the math itself.

**Conclusion: render math (and ideally whole pages) to grayscale bitmaps on the phone, then push
them to the glasses as images, paging/scrolling through them like a teleprompter.**

## Why not text?

- Native teleprompter = **10 lines/page, ~25 chars/line** — can't hold `$$U = I - 2ww^T$$`,
  let alone a 3×3 matrix.
- Display is **monochrome green, 4-bit grayscale** — no rich text styling, but **good for
  anti-aliased/dithered bitmaps**.

## Recommended pipeline

```
.md (text + $…$ / $$…$$ LaTeX)
        │  parse (markdown-it + markdown-it-katex, or remark + remark-math)
        ▼
   KaTeX  →  HTML/SVG  (render in the WebView, offscreen)
        │  rasterize to <canvas> at target pixel width
        ▼
   Canvas (RGBA)
        │  grayscale → invert (white-on-black) → quantize to 16 levels
        │  Floyd–Steinberg dithering to preserve thin strokes
        ▼
   4-bit grayscale bitmap "strips" (page-sized)
        │  cache keyed by content hash
        ▼
   even_hub_sdk image API  →  glasses
```

### Step notes

- **KaTeX over MathJax** for v1: synchronous, fast, no async typesetting races; covers the
  operators in the source (frac, sum/int with limits, matrices via `pmatrix`, Greek, `\|\cdot\|`,
  superscript/subscript stacks).
- **Render at full display width first** (assume 576 px wide working surface), then **slice
  vertically** into page/scroll units. If the SDK image container is truly capped at ~200×100,
  tile each page row into horizontal segments — but first **verify the real limit** (open
  question #2/#4 in the findings).
- **Invert to white-on-black:** the display is dark with bright green pixels; white-on-black
  source maps to bright-green-on-dark, which is what you want for legibility.
- **Dither** (Floyd–Steinberg) when quantizing to 16 levels so 1px fraction bars and serifs
  don't vanish. Test legibility of subscripts/superscripts specifically — they're the first to
  break at low resolution.
- **Cache** rendered strips by a hash of the source segment so autoscroll never blocks on
  rendering. Pre-render the whole selected file at load time (~20 files × N formulas fits phone
  memory easily).

## Legibility budget (must test on hardware)

At 288 px tall and ~7 lines visible, a comfortable body text height is roughly **24–32 px/line**.
Dense inline math (e.g. `a^{(k-1)}_{k,k}`) needs the sub/superscript tier to stay ≥ ~6–8 px to be
readable. **Render larger and scroll more** rather than shrinking to fit — this is a teleprompter,
vertical space is free.

## Document → page model

Treat each library file as a **single tall rendered "ribbon"**:

1. Parse the `.md` into a flow of blocks (prose lines + display equations).
2. Render the whole flow to one tall canvas at the working width.
3. Slice into **page units** = display-height (or container-height) strips, with a small overlap
   so a line is never cut in half.
4. Autoscroll = advance strips on a timer; manual = tap/ring advances one strip.

## Fallbacks / alternatives (ranked)

1. **Image-per-page (primary plan).** Most faithful; depends on the SDK image API.
2. **Hybrid:** prose as native text (fast, scroll-friendly), only equations as inline images.
   Better if the SDK image API is limited but text scrolling is smooth.
3. **Unicode-math approximation** (e.g. `∑`, `√`, superscript digits): only for trivial inline
   bits; **cannot** represent fractions/matrices — not viable for this content.
4. **Direct-BLE bitmap push** (bypassing the SDK, using `i-soxi`/`radioegor146` protocol notes):
   maximum control over the raw framebuffer, but unofficial, fragile, firmware-sensitive. Keep as
   a research escape hatch, not v1.

## Hardware spike (do this before committing to the design)

A tiny end-to-end test that answers the open questions:

- Render one fraction + one 3×3 matrix to a grayscale bitmap.
- Push via `even_hub_sdk` image API; observe **max accepted dimensions** and whether it bypasses
  the teleprompter page structure.
- Measure **send latency** for a full-page image and **chunking** behavior.
- Confirm whether **TouchPad/R1 events** reach the web app.

The results turn the assumptions in [`03-app-architecture.md`](./03-app-architecture.md) into a
final design.
