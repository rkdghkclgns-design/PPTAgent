"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  GOOGLE_MODELS,
  MODEL_SLOT_HINT,
  MODEL_SLOT_LABEL,
  optionsForSlot,
  type ModelSlot,
} from "@/lib/models";
import { cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";

const SLOTS: ModelSlot[] = [
  "research_agent",
  "design_agent",
  "long_context_model",
  "vision_model",
  "t2i_model",
];

export function ModelSelector() {
  const overrides = useStudioStore((s) => s.overrides);
  const setModel = useStudioStore((s) => s.setModel);

  return (
    <div className="space-y-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
        Model routing
      </p>
      <div className="grid gap-2">
        {SLOTS.map((slot) => (
          <SlotRow key={slot} slot={slot} value={overrides[slot] ?? ""} onChange={(v) => setModel(slot, v)} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        기본값은 <span className="font-semibold text-foreground">Google Imagen</span> (T2I) ·{" "}
        <span className="font-semibold text-foreground">Gemini 2.5 Pro</span> (Design). 언제든 변경할 수 있습니다.
      </p>
    </div>
  );
}

function SlotRow({
  slot,
  value,
  onChange,
}: {
  slot: ModelSlot;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const options = optionsForSlot(slot);
  const active = GOOGLE_MODELS.find((m) => m.id === value) ?? options[0];

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring group flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/40 px-3.5 py-2.5 text-left transition hover:border-electron/40 hover:bg-muted/60"
      >
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {MODEL_SLOT_LABEL[slot]}
          </p>
          <p className="mt-1 truncate text-sm font-medium">{active?.label ?? "—"}</p>
        </div>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
      </button>

      {open && (
        <FloatingMenu
          anchor={buttonRef.current}
          onClose={() => setOpen(false)}
        >
          {options.map((opt) => {
            const selected = opt.id === active?.id;
            return (
              <button
                key={opt.id}
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-muted/60",
                  selected && "bg-electron/10",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-electron bg-electron text-background" : "border-border",
                  )}
                >
                  {selected && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {opt.notes ?? MODEL_SLOT_HINT[slot]}
                  </span>
                </span>
              </button>
            );
          })}
        </FloatingMenu>
      )}
    </div>
  );
}

/**
 * Portal-based floating menu anchored to a button element. Uses fixed
 * positioning so it escapes any ancestor `overflow: auto/hidden`, and
 * recomputes its coordinates on scroll/resize so it stays glued to the anchor.
 * Flips above the anchor when there isn't enough room below.
 */
function FloatingMenu({
  anchor,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; flipUp: boolean } | null>(null);

  const reposition = useCallback(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 0;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = menuH > 0 && spaceBelow < menuH + 12 && rect.top > menuH + 12;
    setPos({
      top: flipUp ? rect.top - menuH - 6 : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      flipUp,
    });
  }, [anchor]);

  useLayoutEffect(() => {
    reposition();
  }, [reposition]);

  useEffect(() => {
    if (!anchor) return;
    const handler = () => reposition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [anchor, reposition]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  if (typeof window === "undefined") return null;
  return createPortal(
    <div
      ref={menuRef}
      className="glass fixed z-[80] max-h-[60vh] space-y-1 overflow-y-auto rounded-2xl p-1.5 shadow-halo"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: pos?.width ?? "auto",
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
