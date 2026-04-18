"use client";

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { clampLayout } from "@/lib/imageLayouts";
import type { ImageLayout } from "@/lib/api";
import { cn } from "@/lib/utils";

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

export interface DraggableImageProps {
  src: string;
  layout: ImageLayout;
  /** Parent element whose bounding rect defines 0..1 space. */
  containerRef: React.RefObject<HTMLElement>;
  onChange: (next: ImageLayout) => void;
  /** When false, the image renders but pointer interactions are ignored. */
  interactive?: boolean;
  alt?: string;
  /** Highlight the overlay (dashed border + handles) when selected. */
  selected?: boolean;
  onSelect?: () => void;
}

/**
 * Absolute-positioned image inside a percentage-sized container. Supports
 * body-drag (move) and four corner handles (resize). Reports changes in
 * 0..1 fractions of the container so the same numbers drive both the web
 * preview and the PPTX exporter.
 */
export function DraggableImage({
  src,
  layout,
  containerRef,
  onChange,
  interactive = true,
  alt,
  selected = false,
  onSelect,
}: DraggableImageProps) {
  const [mode, setMode] = useState<DragMode | null>(null);
  const startRef = useRef<{ px: number; py: number; layout: ImageLayout; rect: DOMRect } | null>(null);

  function beginDrag(e: ReactPointerEvent<HTMLElement>, which: DragMode) {
    if (!interactive) return;
    const parent = containerRef.current;
    if (!parent) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect?.();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startRef.current = {
      px: e.clientX,
      py: e.clientY,
      layout,
      rect: parent.getBoundingClientRect(),
    };
    setMode(which);
  }

  function handleMove(e: ReactPointerEvent<HTMLElement>) {
    if (!mode || !startRef.current) return;
    const { px, py, layout: l0, rect } = startRef.current;
    const dx = (e.clientX - px) / rect.width;
    const dy = (e.clientY - py) / rect.height;
    let next: ImageLayout;
    if (mode === "move") {
      next = { x: l0.x + dx, y: l0.y + dy, w: l0.w, h: l0.h };
    } else if (mode === "se") {
      next = { x: l0.x, y: l0.y, w: l0.w + dx, h: l0.h + dy };
    } else if (mode === "nw") {
      next = { x: l0.x + dx, y: l0.y + dy, w: l0.w - dx, h: l0.h - dy };
    } else if (mode === "ne") {
      next = { x: l0.x, y: l0.y + dy, w: l0.w + dx, h: l0.h - dy };
    } else {
      next = { x: l0.x + dx, y: l0.y, w: l0.w - dx, h: l0.h + dy };
    }
    onChange(clampLayout(next));
  }

  function endDrag(e: ReactPointerEvent<HTMLElement>) {
    if (!mode) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    setMode(null);
    startRef.current = null;
  }

  const left = `${layout.x * 100}%`;
  const top = `${layout.y * 100}%`;
  const width = `${layout.w * 100}%`;
  const height = `${layout.h * 100}%`;

  return (
    <div
      onPointerDown={(e) => beginDrag(e, "move")}
      onPointerMove={handleMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        "absolute overflow-hidden rounded-lg",
        interactive && "cursor-move touch-none select-none",
        selected && "ring-2 ring-electron shadow-halo",
      )}
      style={{ left, top, width, height }}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : -1}
    >
      <img
        src={src}
        alt={alt ?? ""}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover pointer-events-none"
      />
      {interactive && selected && (
        <>
          {/* Corner resize handles */}
          <Handle position="nw" onPointerDown={(e) => beginDrag(e, "nw")} />
          <Handle position="ne" onPointerDown={(e) => beginDrag(e, "ne")} />
          <Handle position="sw" onPointerDown={(e) => beginDrag(e, "sw")} />
          <Handle position="se" onPointerDown={(e) => beginDrag(e, "se")} />
          <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-electron/80" />
        </>
      )}
    </div>
  );
}

function Handle({
  position,
  onPointerDown,
}: {
  position: "nw" | "ne" | "sw" | "se";
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  const pos: Record<string, string> = {
    nw: "-left-1.5 -top-1.5 cursor-nwse-resize",
    ne: "-right-1.5 -top-1.5 cursor-nesw-resize",
    sw: "-left-1.5 -bottom-1.5 cursor-nesw-resize",
    se: "-right-1.5 -bottom-1.5 cursor-nwse-resize",
  };
  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "absolute h-3 w-3 rounded-sm border border-background bg-electron shadow-md",
        pos[position],
      )}
    />
  );
}
