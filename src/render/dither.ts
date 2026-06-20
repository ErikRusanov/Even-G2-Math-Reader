// ─────────────────────────────────────────────────────────────────────────
// Grayscale → invert → 4-bit quantize → Floyd–Steinberg dither.
//
// This is the single place that owns the tonal math. The rasterizer hands us
// black-ink-on-white (anti-aliased) RGBA; we turn it into the white-on-black,
// 16-level image the glasses want:
//
//   • grayscale  — collapse RGB to luminance.
//   • invert     — the panel is bright-green ink on a dark field, so what is
//                  BLACK ink in the source must become BRIGHT in the output.
//                  (MathJax draws dark glyphs; we flip so glyphs = bright.)
//   • quantize   — the display is 4-bit: 16 intensity levels (step = 255/15).
//   • dither     — Floyd–Steinberg error diffusion so 1px fraction bars, Σ
//                  strokes and sub/superscript serifs survive quantization
//                  instead of snapping to black and vanishing.
//
// We pre-quantize to the SAME 16 levels the host uses, so its own gray-4 pass
// is a near-identity map and does not re-dither (and thus blur) our result —
// PROVIDED the image is sent at exactly the container size (no host resize).
// ─────────────────────────────────────────────────────────────────────────

const LEVELS = 16
const STEP = 255 / (LEVELS - 1) // 17

/**
 * Convert anti-aliased RGBA (black-on-white) into a white-on-black, 16-level
 * Floyd–Steinberg–dithered grayscale image of the same dimensions.
 */
export function ditherTo4bit(src: ImageData, invert = true): ImageData {
  const { width: w, height: h, data } = src

  // Luminance buffer (float, so error diffusion stays precise).
  const lum = new Float32Array(w * h)
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const v = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
    lum[i] = invert ? 255 - v : v
  }

  const out = new ImageData(w, h)
  const od = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const old = lum[i]
      const q = Math.max(0, Math.min(255, Math.round(old / STEP) * STEP))
      const err = old - q

      // Floyd–Steinberg neighbour weights: 7/16 →, 3/16 ↙, 5/16 ↓, 1/16 ↘.
      if (x + 1 < w) lum[i + 1] += (err * 7) / 16
      if (y + 1 < h) {
        if (x > 0) lum[i + w - 1] += (err * 3) / 16
        lum[i + w] += (err * 5) / 16
        if (x + 1 < w) lum[i + w + 1] += (err * 1) / 16
      }

      const p = i * 4
      od[p] = od[p + 1] = od[p + 2] = q
      od[p + 3] = 255
    }
  }
  return out
}
