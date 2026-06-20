// ─────────────────────────────────────────────────────────────────────────
// Glasses adapter — the ONLY module that talks to `@evenrealities/even_hub_sdk`.
//
// Everything the rest of the app needs from the glasses goes through here:
//   connect()      → wait for the bridge, build the page (image slots + input)
//   setLayout()    → rebuild the page with a different set of image slots
//   sendImage()    → push encoded image bytes to one slot (serial, queued)
//   setStatus()    → update the on-glasses status line
//   onInput()      → subscribe to normalized tap/scroll/exit gestures
//   shutdown()     → close the app on the glasses
//
// SDK facts this wraps (verified against @evenrealities/even_hub_sdk@0.0.10
// types + the official `image` template):
//   • `updateImageRawData` takes a Uint8Array of ENCODED image bytes
//     (PNG/JPEG). The host decodes, resizes to the container, and converts to
//     4-bit grayscale itself. We do NOT pre-pack 4-bit pixels.
//   • Image updates must be SERIAL — one in flight at a time.
//   • Image containers can't capture input. A text container with
//     isEventCapture=1 sits behind them and catches gestures.
//   • Taps/double-taps/lifecycle arrive via `sysEvent`; scrolls via `textEvent`.
//   • CLICK_EVENT === 0, and protobuf omits zero-valued fields, so a tap
//     arrives as a `sysEvent` whose `eventType` is `undefined`.
// ─────────────────────────────────────────────────────────────────────────

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  TextContainerUpgrade,
  OsEventTypeList,
  EventSourceType,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'

import {
  SURFACE,
  IMAGE_LIMITS,
  CONTAINER_LIMITS,
  type ImageSlot,
  type InputEvent,
  type InputSource,
  type SendResult,
} from './types'
import { recordPush } from './perf'

export * from './types'
export { onPush, type PushSample } from './perf'

// Reserved container ids for the adapter's own chrome. Caller image-slot ids
// must not collide with these.
const EVENT_LAYER_ID = 100
const STATUS_ID = 101
// Full-surface text region for native prose: menus, file titles, reading
// hints. Sits BEHIND any image slots, so math images (Iteration 3) overlay it;
// when no images are shown it carries the whole screen (the library/menu UI).
const MESSAGE_ID = 102
const STATUS_HEIGHT = 28

function imageName(id: number): string {
  return `img-${id}`
}

function clampSlot(slot: ImageSlot): ImageSlot {
  const width = Math.max(IMAGE_LIMITS.minW, Math.min(IMAGE_LIMITS.maxW, slot.width))
  const height = Math.max(IMAGE_LIMITS.minH, Math.min(IMAGE_LIMITS.maxH, slot.height))
  return { ...slot, width, height }
}

function normalizeSource(source: EventSourceType | undefined): InputSource {
  switch (source) {
    case EventSourceType.TOUCH_EVENT_FROM_GLASSES_R:
      return 'touchRight'
    case EventSourceType.TOUCH_EVENT_FROM_GLASSES_L:
      return 'touchLeft'
    case EventSourceType.TOUCH_EVENT_FROM_RING:
      return 'ring'
    default:
      return 'unknown'
  }
}

function normalizeEvent(event: EvenHubEvent): InputEvent | null {
  const sys = event.sysEvent
  const text = event.textEvent
  const sysType = sys?.eventType
  const textType = text?.eventType
  const source = normalizeSource(sys?.eventSource)

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    return { type: 'exit', source, raw: event }
  }
  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    return { type: 'doubleTap', source, raw: event }
  }
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
    return { type: 'scrollUp', source, raw: event }
  }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    return { type: 'scrollDown', source, raw: event }
  }
  // CLICK_EVENT (0) is omitted on the wire, so a tap is a sysEvent whose
  // eventType is undefined. Treat "sysEvent present, no other meaning" as tap.
  if (sys && (sysType === OsEventTypeList.CLICK_EVENT || sysType == null)) {
    return { type: 'tap', source, raw: event }
  }
  return null
}

export class GlassesAdapter {
  private bridge: EvenAppBridge | null = null
  private slots = new Map<number, ImageSlot>()
  private built = false
  /** Serializes image pushes — the host accepts one update at a time. */
  private queue: Promise<unknown> = Promise.resolve()

  /** Wait for the WebView↔glasses bridge. Idempotent. */
  async connect(): Promise<void> {
    if (this.bridge) return
    this.bridge = await waitForEvenAppBridge()
  }

  private requireBridge(): EvenAppBridge {
    if (!this.bridge) throw new Error('GlassesAdapter: call connect() first')
    return this.bridge
  }

  private buildContainers(slots: ImageSlot[]) {
    if (slots.length > CONTAINER_LIMITS.maxImages) {
      throw new Error(`Too many image slots: ${slots.length} > ${CONTAINER_LIMITS.maxImages}`)
    }
    const clamped = slots.map(clampSlot)
    this.slots = new Map(clamped.map(s => [s.id, s]))

    // Full-surface text layer that captures all input. Exactly one container
    // may set isEventCapture=1.
    const eventLayer = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: SURFACE.width,
      height: SURFACE.height,
      borderWidth: 0,
      borderColor: 0,
      paddingLength: 0,
      containerID: EVENT_LAYER_ID,
      containerName: 'eventLayer',
      content: ' ',
      isEventCapture: 1,
    })

    const status = new TextContainerProperty({
      xPosition: 0,
      yPosition: SURFACE.height - STATUS_HEIGHT,
      width: SURFACE.width,
      height: STATUS_HEIGHT,
      borderWidth: 0,
      borderColor: 0,
      paddingLength: 4,
      containerID: STATUS_ID,
      containerName: 'status',
      content: ' ',
      isEventCapture: 0,
    })

    // Main native-text region (everything above the status line). Holds menu /
    // file-title / hint prose. ONLY present in menu mode (no image slots): in
    // reading mode the image tiles carry the screen, and because a 2-tile page
    // covers just the top half, a leftover message region would show stale menu
    // text (the file title) in the blank area below. Whitespace content doesn't
    // reliably clear on real G2, so we drop the container entirely on rebuild —
    // that removes the text structurally rather than trying to blank it.
    const includeMessage = clamped.length === 0
    const message = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: SURFACE.width,
      height: SURFACE.height - STATUS_HEIGHT,
      borderWidth: 0,
      borderColor: 0,
      paddingLength: 8,
      containerID: MESSAGE_ID,
      containerName: 'message',
      content: ' ',
      isEventCapture: 0,
    })

    const imageObject = clamped.map(
      s =>
        new ImageContainerProperty({
          xPosition: s.x,
          yPosition: s.y,
          width: s.width,
          height: s.height,
          containerID: s.id,
          containerName: imageName(s.id),
        }),
    )

    // Order matters: message (back) → eventLayer (capture, blank) → status.
    const textObject = includeMessage ? [message, eventLayer, status] : [eventLayer, status]
    return {
      containerTotalNum: imageObject.length + textObject.length,
      textObject,
      imageObject,
    }
  }

  /** Create (first call) or rebuild (subsequent) the page with these image slots. */
  async setLayout(slots: ImageSlot[]): Promise<void> {
    const bridge = this.requireBridge()
    const cfg = this.buildContainers(slots)
    if (!this.built) {
      const created = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(cfg))
      // StartUpPageCreateResult: 0 === success.
      if ((created as unknown as number) !== 0) {
        throw new Error(`createStartUpPageContainer failed: ${created}`)
      }
      this.built = true
    } else {
      const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(cfg))
      if (!ok) throw new Error('rebuildPageContainer failed')
    }
  }

  /**
   * Push encoded image bytes (PNG/JPEG) to one slot. Serialized internally.
   *
   * NB: we pass the Uint8Array (which the SDK converts to a `number[]` for the
   * host). Passing a base64 string instead works on the simulator but the **real
   * G2 firmware does NOT decode it** — slides silently fail to render — so the
   * byte path is the only hardware-safe one. (See docs/01 §image-perf.)
   */
  sendImage(slotId: number, bytes: Uint8Array): Promise<SendResult> {
    const bridge = this.requireBridge()
    if (!this.slots.has(slotId)) {
      return Promise.reject(new Error(`Unknown image slot: ${slotId}`))
    }
    const run = this.queue.then(async () => {
      const msg = new ImageRawDataUpdate({
        containerID: slotId,
        containerName: imageName(slotId),
        imageData: bytes,
      })
      // DIAGNOSTIC: time the Uint8Array → number[] JSON build (what the SDK does
      // internally to cross the bridge) separately from the full round-trip, so we
      // can see if the bridge serialization or the host+BLE is the bottleneck.
      // NB: this builds the payload an extra time, so the measured run is slower
      // than production — read serMs vs (totalMs−serMs), not the absolute total.
      const serT0 = performance.now()
      try {
        ImageRawDataUpdate.toJson(msg)
      } catch {
        /* measurement only */
      }
      const serMs = performance.now() - serT0

      const t0 = performance.now()
      const result = await bridge.updateImageRawData(msg)
      const totalMs = performance.now() - t0
      recordPush({ slot: slotId, bytes: bytes.length, serMs, totalMs })
      return result as unknown as SendResult
    })
    // Keep the chain alive even if one push rejects.
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Update the main native-text region (menu / title / hint prose). */
  async setMessage(text: string): Promise<void> {
    const bridge = this.requireBridge()
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: MESSAGE_ID, containerName: 'message', content: text }),
    )
  }

  /** Update the on-glasses status line. */
  async setStatus(text: string): Promise<void> {
    const bridge = this.requireBridge()
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: STATUS_ID, containerName: 'status', content: text }),
    )
  }

  /** Subscribe to normalized input gestures. Returns an unsubscribe fn. */
  onInput(handler: (event: InputEvent) => void): () => void {
    const bridge = this.requireBridge()
    return bridge.onEvenHubEvent(raw => {
      const normalized = normalizeEvent(raw)
      if (normalized) handler(normalized)
    })
  }

  /** Close the app on the glasses. */
  async shutdown(exitMode = 1): Promise<void> {
    await this.requireBridge().shutDownPageContainer(exitMode)
  }
}

// ── Layout helpers ─────────────────────────────────────────────────────────

/** One image slot, centered on the surface. Clamped to image limits. */
export function layoutSingle(width: number, height: number, id = 1): ImageSlot[] {
  const w = Math.min(width, IMAGE_LIMITS.maxW)
  const h = Math.min(height, IMAGE_LIMITS.maxH)
  return [{ id, x: Math.round((SURFACE.width - w) / 2), y: Math.round((SURFACE.height - h) / 2), width: w, height: h }]
}

/**
 * Two 288×144 slots tiling the TOP HALF of the surface (576×144), left + right.
 *
 * This is the Iteration-6 reading layout. On-device timing proved each image
 * push is a FIXED ~3 s (host + BLE) regardless of payload size, so the only real
 * speedup is FEWER pushes: a 2-tile page = 2 pushes ≈ 6 s vs the 2×2 page's 4
 * pushes ≈ 12 s (and worse under congestion). The reading window is the top half
 * of the glasses; the bottom half stays blank.
 */
export function layoutTile1x2(): ImageSlot[] {
  const w = SURFACE.width / 2 // 288
  const h = SURFACE.height / 2 // 144
  return [
    { id: 1, x: 0, y: 0, width: w, height: h },
    { id: 2, x: w, y: 0, width: w, height: h },
  ]
}

/**
 * Four 288×144 slots tiling the full 576×288 surface (2×2). This is how we
 * probe whether image content can reach the true surface edges.
 */
export function layoutTile2x2(): ImageSlot[] {
  const w = SURFACE.width / 2 // 288
  const h = SURFACE.height / 2 // 144
  return [
    { id: 1, x: 0, y: 0, width: w, height: h },
    { id: 2, x: w, y: 0, width: w, height: h },
    { id: 3, x: 0, y: h, width: w, height: h },
    { id: 4, x: w, y: h, width: w, height: h },
  ]
}
