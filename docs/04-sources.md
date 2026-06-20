# Sources & Verification Log

Multi-agent deep-research run, 2026-06-20. **6 angles · 25 sources fetched · 123 claims
extracted · top 30 verified by 3 independent adversarial voters · 10 confirmed (≥2/3 not
refuted).** Agents ran on Sonnet.

## Confirmed claims (survived 3-vote verification)

| Topic | Claim (short) | Vote | Source |
|---|---|---|---|
| SDK | Official SDK `@evenrealities/even_hub_sdk` + `evenhub-cli` + `evenhub-simulator` | 3-0 | hub.evenrealities.com/docs |
| SDK | Same package set, used with Vite + TypeScript | 3-0 | github.com/even-realities/evenhub-templates |
| Deploy | Apps are web apps running on phone; glasses = display only | 2-1 | hub.evenrealities.com/docs |
| Display | Monochrome green, 16 intensity levels (no RGB) | 2-1 | hub.evenrealities.com/docs |
| Teleprompter | Each page exactly 10 lines, ~25 chars/line, ~7 visible | 2-1 | i-soxi/even-g2-protocol |
| Protocol | G2 pages = 10-line UTF-8 chunks, `\n` sep, 0-indexed varint page no. | 3-0 | i-soxi/even-g2-protocol |
| BLE | G1 Nordic UART, two radios (one per arm) | 3-0 | AGiXT/mobile G1 BLE Protocol |
| BLE | NUS UUIDs (service 6E400001…, write …002, notify …003) | 3-0 | radioegor146/even-utils |
| BLE | Same NUS UUIDs (corroboration) | 2-1 | pypi even-glasses 0.1.7 |
| Scroll | 3 native scroll modes: AI-paced / fixed / manual (R1 ring, TouchPad) | 2-1 | evenrealities.com/teleprompter-glasses |

## Notable refuted / split claims (do NOT rely on)

These were killed (≥2/3 refuted) or split — mostly precise numbers from single reverse-engineering
sources that couldn't be independently corroborated. Useful as leads, not facts:

- G2 resolution "576×288 **per eye**" — 1-2 (the 576×288 figure itself is reported widely; the
  "per eye" framing was the issue).
- 4-bit grayscale "16 shades" as stated by one repo — 1-2 (concept corroborated elsewhere; treat
  4-bit grayscale as the working assumption).
- BLE payload sizes: 180-byte notification / 194-byte BMP packet / 204-byte display packet — 0-3 / 1-2.
- Alternate write-char UUID `00002760-08c2-…` and MTU 512 — 0-3.
- "1-bit BMP at 576×136, usable 488 px" (EvenDemoApp) — 0-3.
- "2-second send rate limit" / WebSocket JSON event model (g2_helloworld) — 0-3 / 1-2.
- Teleprompter "two scroll modes 0x00/0x01, width 267 px" — 0-3.
- "textContainerUpgrade up to 2000 chars" — 1-2.

> Why so many killed: the verifier was deliberately skeptical of **single-source, reverse-
> engineered, numeric** claims and of **G1 facts asserted for G2**. The survivors are the
> cross-corroborated, architecturally-important ones.

## Source inventory (by quality)

### Primary
- https://hub.evenrealities.com/docs — official EvenHub developer docs
- https://github.com/even-realities/evenhub-templates — official starter (Vite + TS + SDK)
- https://github.com/even-realities/EvenDemoApp — official demo (G1-era BLE)
- https://www.npmjs.com/package/@evenrealities/even_hub_sdk
- https://www.npmjs.com/package/@evenrealities/evenhub-cli
- https://www.npmjs.com/package/@evenrealities/evenhub-simulator
- https://www.evenrealities.com/teleprompter-glasses — native teleprompter feature page
- https://github.com/i-soxi/even-g2-protocol — **G2 BLE protocol RE** (teleprompter docs)
- https://github.com/radioegor146/even-utils — G1 protocol RE, NUS UUIDs
- https://github.com/AGiXT/mobile/blob/main/Even%20Realities%20G1%20BLE%20Protocol.txt
- https://pypi.org/project/even-glasses/0.1.7 — Python BLE lib (G1)
- https://github.com/gpsnmeajp/g2_helloworld — minimal SDK example
- https://github.com/DMOJ/texoid — LaTeX→SVG/PNG service
- https://github.com/mneri/pnglatex — LaTeX→PNG
- https://github.com/klatexformula/klatexformula — LaTeX→image GUI

### Secondary / community
- https://github.com/fabioglimb/even-toolkit — general G2 utilities
- https://github.com/nickustinov/even-g2-notes — community G2 spec notes
- https://github.com/hqrrr/EvenComfort
- https://gadgetbridge.org/gadgets/others/even_realities/ — Gadgetbridge support notes
- https://www.notebookcheck.net/Even-G2-Smart-Glasses-with-1-200-Nits-Micro-LED-Display-now-available.1269318.0.html

### Blog / forum
- https://zenn.dev/bigdra/articles/eveng2-sdk-features — SDK feature writeup (image limits)
- https://www.mfitzp.com/tutorials/displaying-images-oled-displays/ — bitmap-for-tiny-display technique
- https://github.com/KaTeX/KaTeX/issues/328 — KaTeX rendering discussion

## Method

Architecture: `Scope (fixed angles) → pipeline(Search → URL-dedup → Fetch+Extract) → 3-vote
adversarial Verify → Synthesize`. Each claim needed a direct quote; verifiers searched for
contradicting evidence and defaulted to "refuted" when uncertain. Full machine-readable output:
the workflow task result (`wq3i5snjm`).
