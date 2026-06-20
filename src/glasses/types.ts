// Adapter-level types. These are intentionally SDK-agnostic: nothing outside
// `src/glasses/` should import from `@evenrealities/even_hub_sdk` directly, so
// that the rest of the app is insulated from SDK v0.0.x churn.

/** The glasses panel: 576×288 px, monochrome green, 4-bit grayscale. */
export const SURFACE = { width: 576, height: 288 } as const

/**
 * Per-image-container size limits, straight from the SDK's
 * `ImageContainerProperty` (PB Width 20~288, Height 20~144).
 * A single image cannot cover the full surface — tile up to 4 of them.
 */
export const IMAGE_LIMITS = { minW: 20, maxW: 288, minH: 20, maxH: 144 } as const

/** Up to 4 image containers + up to 8 text containers, 12 total (SDK limits). */
export const CONTAINER_LIMITS = { maxImages: 4, maxTexts: 8, maxTotal: 12 } as const

/** One image slot on the surface. `id` is the container id used by `sendImage`. */
export interface ImageSlot {
  id: number
  x: number
  y: number
  width: number
  height: number
}

/** Normalized input gesture, abstracted away from the raw protobuf events. */
export type InputType = 'tap' | 'doubleTap' | 'scrollUp' | 'scrollDown' | 'exit'

/** Where the gesture came from. */
export type InputSource = 'touchRight' | 'touchLeft' | 'ring' | 'unknown'

export interface InputEvent {
  type: InputType
  source: InputSource
  /** The raw SDK event, kept for spike-time logging/debugging. */
  raw?: unknown
}

/** Result of pushing an image; mirrors the SDK's send-image result codes. */
export type SendResult = 'success' | 'imageException' | 'imageSizeInvalid' | 'imageToGray4Failed' | string
