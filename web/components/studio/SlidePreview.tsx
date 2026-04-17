"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  Expand,
  ImageOff,
  Link2,
  Loader2,
  Maximize2,
  MessageCircle,
  Radio,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { MotionButton } from "@/components/common/MotionButton";
import { useStudioStore } from "@/lib/store";
import { downloadPptx } from "@/lib/pptx";
import { renderMermaid, svgToDataUrl } from "@/lib/mermaid";
import { cn } from "@/lib/utils";
import type { SlideData, SlideKind } from "@/lib/api";

const KIND_STYLE: Record<SlideKind, { label: string; icon: React.ComponentType<any>; tint: string }> = {
  cover: { label: "표지", icon: Sparkles, tint: "text-electron" },
  objectives: { label: "학습 목표", icon: Target, tint: "text-aurora" },
  content: { label: "본문", icon: Maximize2, tint: "text-muted-foreground" },
  summary: { label: "정리", icon: Radio, tint: "text-sunrise" },
  qna: { label: "질의응답", icon: MessageCircle, tint: "text-electron" },
};

export function SlidePreview() {
  const slides = useStudioStore((s) => s.slides);
  const active = useStudioStore((s) => s.activeSlide);
  const setActive = useStudioStore((s) => s.setActiveSlide);
  const status = useStudioStore((s) => s.status);
  const progress = useStudioStore((s) => s.progress);
  const error = useStudioStore((s) => s.error);
  const prompt = useStudioStore((s) => s.prompt);
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
                "Supabase 에 API 키가 구성되지 않아 샘플 슬라이드를 반환했습니다."}
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
                "Claude 가 텍스트를 생성하고, 커버는 프로시저럴 그라디언트로 대체됐습니다."}
            </p>
          </motion.div>
        )}
        {provider === "google" && providerNote && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-sunrise/40 bg-sunrise/5 px-4 py-3 text-xs text-sunrise/90"
          >
            <p className="font-semibold">이미지 생성 안내</p>
            <p className="mt-1 text-sunrise/80">{providerNote}</p>
          </motion.div>
        )}

        <MainSlide
          slide={current}
          status={status}
          progress={progress}
          error={error}
          onZoom={() => current && setZoomOpen(true)}
        />

        {current && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>슬라이드 {active + 1} / {slides.length}</span>
            <KindBadge kind={current.kind} />
          </div>
        )}

        <ThumbnailStrip slides={slides} active={active} onSelect={setActive} status={status} />

        {current?.sources && current.sources.length > 0 && (
          <SourcesList sources={current.sources} />
        )}

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

function KindBadge({ kind }: { kind: SlideKind }) {
  const k = KIND_STYLE[kind] ?? KIND_STYLE.content;
  const Icon = k.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 font-medium", k.tint)}>
      <Icon className="h-3 w-3" />
      {k.label}
    </span>
  );
}

function SourcesList({ sources }: { sources: NonNullable<SlideData["sources"]> }) {
  return (
    <div className="rounded-2xl border border-aurora/30 bg-aurora/5 p-4">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-aurora">
        <Link2 className="h-3 w-3" /> 출처
      </p>
      <ul className="space-y-1 text-xs leading-relaxed text-foreground/85">
        {sources.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-aurora/70">[{i + 1}]</span>
            {s.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
                className="break-all underline-offset-2 hover:underline"
              >
                {s.label}
              </a>
            ) : (
              <span className="break-words">{s.label}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main slide
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
          내용·이미지·다이어그램을 동시에 생성 중입니다. 보통 30~90초 걸립니다.
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
// Kind-aware slide canvas
// ---------------------------------------------------------------------------

function SlideCanvas({
  slide,
  scale,
}: {
  slide: SlideData;
  scale: "preview" | "zoom";
}) {
  const padding = scale === "zoom" ? "p-12" : "p-6";
  const titleSize =
    slide.kind === "cover"
      ? scale === "zoom" ? "text-6xl" : "text-3xl"
      : scale === "zoom" ? "text-4xl" : "text-xl";
  const bulletSize = scale === "zoom" ? "text-lg" : "text-[11px]";
  const accentHeight = scale === "zoom" ? "h-1.5" : "h-1";
  const accentWidth = scale === "zoom" ? "w-16" : "w-10";

  // Cover layout: giant title centred, gradient image as background.
  if (slide.kind === "cover") {
    return (
      <div className={cn("relative aspect-video w-full overflow-hidden bg-ink-900", padding)}>
        {slide.imageUrl && (
          <img
            src={slide.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-60"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-br from-ink-950/80 via-ink-900/40 to-ink-950/90" />
        <div className="relative flex h-full flex-col justify-end">
          <p className="text-xs uppercase tracking-[0.3em] text-electron/80">Cover</p>
          <h3 className={cn("mt-2 font-display font-bold tracking-tight text-foreground", titleSize)}>
            {slide.title}
          </h3>
          {slide.bullets?.length > 0 && (
            <p className={cn("mt-4 text-foreground/80", scale === "zoom" ? "text-xl" : "text-sm")}>
              {slide.bullets[0]}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Objectives: checklist layout with mint accents.
  if (slide.kind === "objectives") {
    return (
      <div className={cn("relative aspect-video w-full bg-ink-900", padding)}>
        <p className="text-[10px] uppercase tracking-[0.3em] text-aurora">학습 목표</p>
        <h3 className={cn("mt-1 font-display font-semibold tracking-tight text-foreground", titleSize)}>
          {slide.title}
        </h3>
        <div className={cn("mt-3 rounded-full bg-aurora", accentHeight, accentWidth)} />
        <ul className={cn("mt-6 space-y-3", bulletSize)}>
          {slide.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3 text-foreground/90">
              <span className="mt-[0.15em] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-aurora/60 text-[10px] font-bold text-aurora">
                {i + 1}
              </span>
              <span className="flex-1">{b}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Summary: sunrise-tinted highlight cards.
  if (slide.kind === "summary") {
    return (
      <div className={cn("relative aspect-video w-full bg-ink-900", padding)}>
        <p className="text-[10px] uppercase tracking-[0.3em] text-sunrise">Summary</p>
        <h3 className={cn("mt-1 font-display font-semibold tracking-tight text-foreground", titleSize)}>
          {slide.title}
        </h3>
        <div className={cn("mt-3 rounded-full bg-sunrise", accentHeight, accentWidth)} />
        <div className={cn("mt-5 grid gap-3", scale === "zoom" ? "grid-cols-2" : "grid-cols-1")}>
          {slide.bullets.map((b, i) => (
            <div
              key={i}
              className="rounded-xl border border-sunrise/30 bg-sunrise/5 p-3 text-foreground/90"
            >
              <p className={cn("font-medium", bulletSize)}>{b}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Q&A: minimal layout
  if (slide.kind === "qna") {
    return (
      <div className={cn("relative flex aspect-video w-full flex-col items-center justify-center gap-4 bg-ink-900 text-center", padding)}>
        <MessageCircle className={cn("text-electron", scale === "zoom" ? "h-14 w-14" : "h-7 w-7")} />
        <h3 className={cn("font-display font-bold tracking-tight text-foreground", titleSize)}>
          {slide.title}
        </h3>
        {slide.bullets?.[0] && (
          <p className="max-w-[80%] text-muted-foreground">{slide.bullets[0]}</p>
        )}
      </div>
    );
  }

  // Content (default): text on the left, diagram/image on the right.
  return (
    <div className={cn("relative aspect-video w-full bg-ink-900", padding)}>
      <div className="relative flex h-full gap-5">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className={cn("font-display font-semibold tracking-tight text-foreground", titleSize)}>
            {slide.title}
          </h3>
          <div className={cn("mt-3 rounded-full bg-electron", accentHeight, accentWidth)} />
          <ul className={cn("mt-4 space-y-1.5 text-foreground/85", bulletSize)}>
            {slide.bullets?.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[0.35em] h-1 w-1 shrink-0 rounded-full bg-aurora" />
                <span className="min-w-0 flex-1">{b}</span>
              </li>
            ))}
          </ul>
        </div>
        {(slide.diagram || slide.imageUrl) && (
          <div className="relative hidden aspect-square w-[42%] shrink-0 overflow-hidden rounded-xl border border-border/40 md:block">
            {slide.diagram ? (
              <DiagramRenderer code={slide.diagram} />
            ) : slide.imageUrl ? (
              <img
                src={slide.imageUrl}
                alt={slide.imagePrompt ?? slide.title}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function DiagramRenderer({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    renderMermaid(code, "preview").then((result) => {
      if (alive) setSvg(result);
    });
    return () => {
      alive = false;
    };
  }, [code]);
  if (!svg) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-3 text-[10px] text-muted-foreground">
        다이어그램 렌더링 중...
      </div>
    );
  }
  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-2 [&_svg]:h-full [&_svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ---------------------------------------------------------------------------
// Thumbnail strip + zoom modal
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
          title={s.title}
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
        {(slide.notes || (slide.sources && slide.sources.length > 0)) && (
          <div className="border-t border-border/50 bg-ink-950/80 p-4">
            {slide.notes && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Speaker Notes
                </p>
                <p className="text-sm text-foreground/85">{slide.notes}</p>
              </div>
            )}
            {slide.sources && slide.sources.length > 0 && (
              <div className="mt-3 border-t border-border/40 pt-3">
                <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-aurora">
                  <Link2 className="h-3 w-3" /> 출처
                </p>
                <ul className="space-y-0.5 text-xs text-foreground/80">
                  {slide.sources.map((s, i) => (
                    <li key={i}>
                      <span className="text-aurora/70">[{i + 1}]</span>{" "}
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="break-all underline-offset-2 hover:underline"
                        >
                          {s.label}
                        </a>
                      ) : (
                        s.label
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
