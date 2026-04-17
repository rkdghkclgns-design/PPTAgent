"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Expand, ImageOff, Loader2, Maximize2, Radio, X } from "lucide-react";
import { toast } from "sonner";

import { MotionButton } from "@/components/common/MotionButton";
import { useStudioStore } from "@/lib/store";
import { downloadPptx } from "@/lib/pptx";
import { cn } from "@/lib/utils";
import type { SlideData } from "@/lib/api";

export function SlidePreview() {
  const slides = useStudioStore((s) => s.slides);
  const active = useStudioStore((s) => s.activeSlide);
  const setActive = useStudioStore((s) => s.setActiveSlide);
  const status = useStudioStore((s) => s.status);
  const progress = useStudioStore((s) => s.progress);
  const error = useStudioStore((s) => s.error);
  const prompt = useStudioStore((s) => s.prompt);
  const sampleMode = useStudioStore((s) => s.sampleMode);
  const provider = useStudioStore((s) => s.provider);
  const providerNote = useStudioStore((s) => s.providerNote);

  const [zoomOpen, setZoomOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const current: SlideData | null = slides[active] ?? slides[0] ?? null;

  async function handleDownload() {
    if (slides.length === 0) return;
    setDownloading(true);
    try {
      const name = await downloadPptx(slides, prompt);
      toast.success(`${name} 다운로드 시작`);
    } catch (err) {
      console.error(err);
      toast.error("PPTX 생성 실패");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <aside className="flex h-full w-[520px] shrink-0 flex-col border-l border-border/60 bg-card/40 backdrop-blur-xl">
      <header className="flex items-center justify-between border-b border-border/60 px-5 py-3">
        <div className="flex items-center gap-2">
          <Maximize2 className="h-4 w-4 text-electron" />
          <p className="text-sm font-semibold">실시간 프리뷰</p>
        </div>
        <MotionButton
          size="sm"
          variant={slides.length > 0 ? "primary" : "secondary"}
          disabled={slides.length === 0 || downloading}
          onClick={handleDownload}
          iconLeft={
            downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )
          }
        >
          {downloading ? "내려받는 중" : "PPTX 내려받기"}
        </MotionButton>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto scrollbar-slim p-5">
        {provider === "sample" && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-sunrise/40 bg-sunrise/10 px-4 py-3 text-xs text-sunrise"
          >
            <p className="font-semibold">샘플 모드</p>
            <p className="mt-1 text-sunrise/80">
              {providerNote ??
                "Supabase 에 API 키가 구성되지 않아 샘플 슬라이드를 반환했습니다. 키 등록 후 자동으로 실제 AI 생성으로 전환됩니다."}
            </p>
          </motion.div>
        )}
        {provider === "anthropic" && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-electron/40 bg-electron/10 px-4 py-3 text-xs text-electron"
          >
            <p className="font-semibold">Anthropic Claude</p>
            <p className="mt-1 text-electron/80">
              {providerNote ??
                "Claude 가 텍스트를 생성하고, 커버는 프로시저럴 그라디언트로 대체됐습니다. 실제 AI 이미지는 GOOGLE_API_KEY 를 등록해 주세요."}
            </p>
          </motion.div>
        )}

        {/* Large main slide */}
        <MainSlide
          slide={current}
          status={status}
          progress={progress}
          error={error}
          onZoom={() => current && setZoomOpen(true)}
        />

        {/* Slide index info */}
        {current && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              슬라이드 {active + 1} / {slides.length}
            </span>
            <span className="font-mono">{current.title.slice(0, 30)}</span>
          </div>
        )}

        {/* Thumbnail strip */}
        <ThumbnailStrip slides={slides} active={active} onSelect={setActive} status={status} />

        {/* Notes for the active slide */}
        {current?.notes && (
          <div className="rounded-2xl border border-border/60 bg-ink-950/60 p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Speaker Notes
            </p>
            <p className="text-xs leading-relaxed text-foreground/80">{current.notes}</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {zoomOpen && current && (
          <ZoomModal slide={current} onClose={() => setZoomOpen(false)} />
        )}
      </AnimatePresence>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Main slide (enlarged)
// ---------------------------------------------------------------------------

function MainSlide({
  slide,
  status,
  progress,
  error,
  onZoom,
}: {
  slide: SlideData | null;
  status: string;
  progress: number;
  error: string | null;
  onZoom: () => void;
}) {
  if (status === "running" && !slide) {
    return (
      <div className="glass relative flex aspect-video flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center">
        <Radio className="h-6 w-6 animate-breathing text-electron" />
        <p className="text-sm font-semibold">AI 가 슬라이드를 작성 중입니다</p>
        <div className="h-1 w-3/4 overflow-hidden rounded-full bg-border/70">
          <motion.div
            className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--electron))_0%,hsl(var(--aurora))_100%)]"
            animate={{ width: `${Math.round(progress * 100)}%` }}
            transition={{ type: "spring", stiffness: 140, damping: 25 }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          내용과 이미지를 동시에 생성하고 있어요. 보통 20~60초 걸립니다.
        </p>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="glass flex aspect-video flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/40 p-6 text-center">
        <ImageOff className="h-6 w-6 text-destructive" />
        <p className="text-sm font-semibold">생성에 실패했습니다</p>
        <p className="max-w-[80%] text-xs text-muted-foreground">
          {error ?? "다시 시도해 주세요."}
        </p>
      </div>
    );
  }

  if (!slide) {
    return (
      <div className="glass flex aspect-video flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center text-muted-foreground">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
          <Radio className="h-4 w-4 text-electron" />
        </div>
        <p className="text-sm font-medium">프롬프트 실행 대기 중</p>
      </div>
    );
  }

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      onClick={onZoom}
      className="group relative block w-full overflow-hidden rounded-2xl border border-border/60 bg-ink-900 text-left shadow-glass"
      aria-label="클릭하여 확대 보기"
    >
      <SlideCanvas slide={slide} scale="preview" />
      <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-ink-950/70 px-2.5 py-1 text-[10px] font-medium text-muted-foreground opacity-0 transition group-hover:opacity-100">
        <Expand className="h-3 w-3" /> 클릭하여 확대
      </div>
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// Slide canvas (rendered layout - also used inside the zoom modal)
// ---------------------------------------------------------------------------

function SlideCanvas({
  slide,
  scale,
}: {
  slide: SlideData;
  scale: "preview" | "zoom";
}) {
  const padding = scale === "zoom" ? "p-10" : "p-5";
  const titleSize = scale === "zoom" ? "text-4xl" : "text-xl";
  const bulletSize = scale === "zoom" ? "text-lg" : "text-[11px]";
  const accentHeight = scale === "zoom" ? "h-1.5" : "h-1";
  const accentWidth = scale === "zoom" ? "w-16" : "w-10";
  const gap = scale === "zoom" ? "gap-10" : "gap-4";

  return (
    <div className={cn("relative aspect-video w-full bg-ink-900", padding)}>
      <div className={cn("relative flex h-full", gap, slide.imageUrl ? "" : "")}>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3
            className={cn(
              "font-display font-semibold tracking-tight text-foreground",
              titleSize,
            )}
          >
            {slide.title}
          </h3>
          <div className={cn("mt-3 rounded-full bg-electron", accentHeight, accentWidth)} />
          <ul
            className={cn(
              "mt-4 space-y-1.5 text-foreground/85",
              bulletSize,
            )}
          >
            {slide.bullets?.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[0.35em] h-1 w-1 shrink-0 rounded-full bg-aurora" />
                <span className="min-w-0 flex-1">{b}</span>
              </li>
            ))}
          </ul>
        </div>
        {slide.imageUrl && (
          <div className="relative hidden aspect-square w-[42%] shrink-0 overflow-hidden rounded-xl border border-border/40 md:block">
            <img
              src={slide.imageUrl}
              alt={slide.imagePrompt ?? slide.title}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thumbnail strip (2-row grid, scrolls for >8)
// ---------------------------------------------------------------------------

function ThumbnailStrip({
  slides,
  active,
  onSelect,
  status,
}: {
  slides: SlideData[];
  active: number;
  onSelect: (i: number) => void;
  status: string;
}) {
  const placeholderCount = status === "running" && slides.length === 0 ? 6 : 0;
  return (
    <div className="grid grid-cols-4 gap-2">
      {slides.map((s, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          className={cn(
            "group relative aspect-video overflow-hidden rounded-lg border border-border/60 bg-ink-900 transition",
            active === i && "border-electron ring-2 ring-electron/40",
          )}
        >
          {s.imageUrl ? (
            <img src={s.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center p-1.5 text-center text-[8px] font-medium leading-tight text-foreground/70">
              {s.title.slice(0, 24)}
            </div>
          )}
          <span className="absolute bottom-0.5 right-1 rounded bg-ink-950/70 px-1 text-[9px] font-mono text-muted-foreground">
            {i + 1}
          </span>
        </button>
      ))}
      {Array.from({ length: placeholderCount }).map((_, i) => (
        <div
          key={`ph-${i}`}
          className="relative aspect-video animate-pulse rounded-lg border border-border/40 bg-muted/20"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zoom modal - click anywhere / Esc to close
// ---------------------------------------------------------------------------

function ZoomModal({
  slide,
  onClose,
}: {
  slide: SlideData;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-6xl overflow-hidden rounded-3xl border border-border/50 shadow-halo"
      >
        <SlideCanvas slide={slide} scale="zoom" />
        <button
          onClick={onClose}
          className="focus-ring absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-ink-950/80 text-muted-foreground transition hover:border-electron/50 hover:text-foreground"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
        {slide.notes && (
          <div className="border-t border-border/50 bg-ink-950/80 p-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Speaker Notes
            </p>
            <p className="text-sm text-foreground/85">{slide.notes}</p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
