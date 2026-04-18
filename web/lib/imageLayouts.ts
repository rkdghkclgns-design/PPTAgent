/**
 * Helpers for per-slide image placement overrides.
 *
 * An `ImageLayout` is `{ x, y, w, h }` expressed as fractions of the slide
 * (16:9). The web preview, zoom-modal overlay, and PPTX exporter all read
 * the same numbers, so a layout that looks right on screen also exports
 * correctly.
 */

import type { ImageLayout, SlideKind } from "./api";

/** Preset quick-picks surfaced in the edit modal sidebar. */
export const IMAGE_LAYOUT_PRESETS: Array<{ id: string; label: string; layout: ImageLayout }> = [
  { id: "right-half", label: "오른쪽 절반", layout: { x: 0.52, y: 0.1, w: 0.43, h: 0.8 } },
  { id: "left-half", label: "왼쪽 절반", layout: { x: 0.05, y: 0.1, w: 0.43, h: 0.8 } },
  { id: "full", label: "전체 배경", layout: { x: 0, y: 0, w: 1, h: 1 } },
  { id: "top-band", label: "상단 밴드", layout: { x: 0.05, y: 0.06, w: 0.9, h: 0.35 } },
  { id: "bottom-band", label: "하단 밴드", layout: { x: 0.05, y: 0.58, w: 0.9, h: 0.35 } },
  { id: "center", label: "중앙", layout: { x: 0.25, y: 0.2, w: 0.5, h: 0.6 } },
];

/** Sensible initial layout for the primary image on a given kind. */
export function defaultLayoutForKind(kind: SlideKind): ImageLayout {
  switch (kind) {
    case "cover":
    case "summary":
    case "qna":
      return { x: 0, y: 0, w: 1, h: 1 };
    case "objectives":
      return { x: 0.55, y: 0.1, w: 0.4, h: 0.8 };
    case "content":
    default:
      return { x: 0.54, y: 0.1, w: 0.42, h: 0.8 };
  }
}

/** Clamp a layout so it never leaves the slide. */
export function clampLayout(l: ImageLayout): ImageLayout {
  const w = Math.max(0.05, Math.min(1, l.w));
  const h = Math.max(0.05, Math.min(1, l.h));
  const x = Math.max(0, Math.min(1 - w, l.x));
  const y = Math.max(0, Math.min(1 - h, l.y));
  return { x, y, w, h };
}
