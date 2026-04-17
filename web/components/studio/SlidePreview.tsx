"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Download, Monitor, Radio } from "lucide-react";

import { MotionButton } from "@/components/common/MotionButton";
import { useStudioStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function SlidePreview() {
  const slides = useStudioStore((s) => s.slides);
  const active = useStudioStore((s) => s.activeSlide);
  const setActive = useStudioStore((s) => s.setActiveSlide);
  const events = useStudioStore((s) => s.events);
  const pptxUrl = useStudioStore((s) => s.pptxUrl);
  const job = useStudioStore((s) => s.job);

  const hasSlides = slides.length > 0;
  const currentSlide = hasSlides ? slides[active] ?? slides[0] : null;
  const latestEvent = events.at(-1);

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-border/60 bg-card/40 backdrop-blur-xl">
      <header className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-electron" />
          <p className="text-sm font-semibold">실시간 프리뷰</p>
        </div>
        {pptxUrl && (
          <a href={pptxUrl} target="_blank" rel="noreferrer">
            <MotionButton size="sm" variant="secondary" iconLeft={<Download className="h-3.5 w-3.5" />}>
              PPTX
            </MotionButton>
          </a>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto scrollbar-slim p-5">
        <div className="glass relative aspect-video overflow-hidden rounded-2xl">
          <AnimatePresence mode="wait">
            {currentSlide?.imageUrl ? (
              <motion.img
                key={currentSlide.imageUrl}
                src={currentSlide.imageUrl}
                alt={currentSlide.title ?? `Slide ${currentSlide.index + 1}`}
                className="absolute inset-0 h-full w-full object-cover"
                initial={{ opacity: 0, scale: 1.02 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              />
            ) : (
              <motion.div
                key="placeholder"
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
                  <Radio className="h-4 w-4 animate-breathing text-electron" />
                </div>
                <p className="text-sm font-medium">
                  {job ? "슬라이드가 곧 표시됩니다" : "Prompt 실행 대기 중"}
                </p>
                {latestEvent && (
                  <p className="max-w-[80%] text-xs leading-relaxed text-muted-foreground/80">
                    {latestEvent.message}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: Math.max(slides.length, 6) }).map((_, i) => {
            const s = slides[i];
            return (
              <button
                key={i}
                onClick={() => s && setActive(i)}
                className={cn(
                  "group relative aspect-video overflow-hidden rounded-lg border border-border/60 bg-muted/40 transition",
                  active === i && "border-electron ring-2 ring-electron/40",
                  !s && "opacity-40",
                )}
              >
                {s?.imageUrl ? (
                  <img src={s.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                    {i + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <EventLog />
      </div>
    </aside>
  );
}

function EventLog() {
  const events = useStudioStore((s) => s.events);
  return (
    <div className="rounded-2xl border border-border/60 bg-ink-950/60 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        Event stream
      </p>
      <ul className="max-h-44 space-y-1.5 overflow-y-auto scrollbar-slim pr-1 font-mono text-[11px] text-muted-foreground">
        {events.length === 0 && <li>· 대기 중…</li>}
        {events.map((ev, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="truncate"
          >
            <span className="text-electron">{ev.stage}</span>{" "}
            <span className="text-foreground/70">{ev.message}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
