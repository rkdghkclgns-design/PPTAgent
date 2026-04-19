"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Expand,
  ImageOff,
  ImagePlus,
  ImageUp,
  Link2,
  Loader2,
  Maximize2,
  MessageCircle,
  Plus,
  Radio,
  RefreshCcw,
  Sparkles,
  Target,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { MotionButton } from "@/components/common/MotionButton";
import { DraggableImage } from "@/components/studio/DraggableImage";
import { useStudioStore } from "@/lib/store";
import { downloadPptx } from "@/lib/pptx";
import { renderMermaid, svgToDataUrl } from "@/lib/mermaid";
import {
  clampLayout,
  defaultLayoutForIndex,
  hasAnyLayoutOverride,
  IMAGE_LAYOUT_PRESETS,
} from "@/lib/imageLayouts";
import { cn } from "@/lib/utils";
import {
  imageFileToDataUrl,
  regenerateSlideImage,
  type ImageLayout,
  type SlideData,
  type SlideKind,
  type SlideTextStyle,
} from "@/lib/api";

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
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  // When the user clicks "편집" inside fullscreen we close fullscreen,
  // open the edit modal, and remember to re-enter fullscreen on modal
  // close (apply or cancel) so the presentation flow isn't broken.
  const [resumeFullscreen, setResumeFullscreen] = useState(false);

  const current: SlideData | null = slides[active] ?? slides[0] ?? null;

  async function toggleFullscreen() {
    const nextOpen = !fullscreenOpen;
    setFullscreenOpen(nextOpen);
    // Best-effort: ask the browser for true fullscreen so the chrome bar
    // disappears. Falls back to a CSS overlay when the API is blocked.
    try {
      if (nextOpen) {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen?.();
      }
    } catch {
      /* fullscreen API rejected — the CSS overlay still renders */
    }
  }

  /** Called from FullscreenDeck's header: suspend fullscreen, open edit. */
  async function startEditFromFullscreen() {
    setResumeFullscreen(true);
    setFullscreenOpen(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
    } catch {
      /* ignore */
    }
    // Small delay so the fullscreen overlay is fully unmounted before the
    // modal opens (avoids z-index flash).
    requestAnimationFrame(() => setZoomOpen(true));
  }

  /** Called from ZoomModal onClose: if we came from fullscreen, re-enter. */
  async function closeZoomMaybeResume() {
    setZoomOpen(false);
    if (resumeFullscreen) {
      setResumeFullscreen(false);
      requestAnimationFrame(async () => {
        setFullscreenOpen(true);
        try {
          if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
        } catch {
          /* ignore */
        }
      });
    }
  }

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
    <aside className="flex h-full min-h-0 w-[520px] shrink-0 flex-col border-l border-border/60 bg-card/40 backdrop-blur-xl">
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-3">
        <button
          type="button"
          onClick={toggleFullscreen}
          disabled={slides.length === 0}
          className="focus-ring group flex items-center gap-2 rounded-xl px-2 py-1 transition hover:bg-muted/50 disabled:opacity-40 disabled:hover:bg-transparent"
          title={slides.length === 0 ? "슬라이드 생성 후 사용" : "브라우저 전체 확대"}
        >
          <Maximize2 className="h-4 w-4 text-electron transition group-hover:scale-110" />
          <p className="text-sm font-semibold">실시간 프리뷰</p>
        </button>
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

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scrollbar-slim p-5">
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
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>슬라이드 {active + 1} / {slides.length}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoomOpen(true)}
                className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 font-medium text-foreground/80 transition hover:border-electron/50 hover:text-foreground"
                title="확대 · 편집"
              >
                <Expand className="h-3 w-3" /> 확대 · 편집
              </button>
              <KindBadge kind={current.kind} />
            </div>
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
          <ZoomModal
            slide={current}
            slideIndex={active}
            onClose={closeZoomMaybeResume}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {fullscreenOpen && slides.length > 0 && (
          <FullscreenDeck
            slides={slides}
            active={active}
            onSelect={setActive}
            onRequestEdit={startEditFromFullscreen}
            onClose={async () => {
              setFullscreenOpen(false);
              try {
                if (document.fullscreenElement) await document.exitFullscreen?.();
              } catch {
                /* ignore */
              }
            }}
          />
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

const FONT_FAMILY_CLASS: Record<NonNullable<SlideTextStyle["fontFamily"]>, string> = {
  sans: "[&_h3]:!font-sans [&_ul]:!font-sans [&_p]:!font-sans",
  serif: "[&_h3]:!font-serif [&_ul]:!font-serif [&_p]:!font-serif",
  display: "[&_h3]:!font-display",
};

function SlideCanvas({
  slide,
  scale,
  hideAllImages,
}: {
  slide: SlideData;
  scale: "preview" | "zoom";
  /** When true, the kind's default image slots render empty so an overlay
   *  (DraggableImages from the parent) can take their place cleanly. */
  hideAllImages?: boolean;
}) {
  const padding = scale === "zoom" ? "p-12" : "p-6";
  const ts = slide.textStyle ?? {};
  const titleScale = ts.titleScale ?? 1;
  const bulletScale = ts.bulletScale ?? 1;
  const titleSizePx =
    slide.kind === "cover"
      ? (scale === "zoom" ? 60 : 30) * titleScale
      : (scale === "zoom" ? 36 : 20) * titleScale;
  const bulletSizePx = (scale === "zoom" ? 18 : 11) * bulletScale;
  const titleStyle = { fontSize: `${titleSizePx}px` } as const;
  const bulletStyle = { fontSize: `${bulletSizePx}px` } as const;
  const titleWeightClass = ts.titleWeight === "bold" ? "font-bold" : ts.titleWeight === "semibold" ? "font-semibold" : "";
  const fontFamilyClass = ts.fontFamily ? FONT_FAMILY_CLASS[ts.fontFamily] : "";
  // Keep the legacy "titleSize" class just for backwards compatibility (used
  // in a couple of spots not yet refactored).
  const titleSize =
    slide.kind === "cover"
      ? scale === "zoom" ? "text-6xl" : "text-3xl"
      : scale === "zoom" ? "text-4xl" : "text-xl";
  const bulletSize = scale === "zoom" ? "text-lg" : "text-[11px]";
  const accentHeight = scale === "zoom" ? "h-1.5" : "h-1";
  const accentWidth = scale === "zoom" ? "w-16" : "w-10";
  // When imageLayouts has any non-null entry, the whole slide switches to
  // free-form image rendering. Kind-default image slots are suppressed so
  // the overlay images don't double up.
  const freeform = hasAnyLayoutOverride(slide.imageLayouts);
  const suppressKindImages = hideAllImages || freeform;

  // Cover layout: giant title centred, gradient image as background.
  if (slide.kind === "cover") {
    return (
      <div className={cn("relative aspect-video w-full overflow-hidden bg-ink-900", padding, fontFamilyClass)}>
        {slide.imageUrl && !suppressKindImages && (
          <img
            src={slide.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-60"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-br from-ink-950/80 via-ink-900/40 to-ink-950/90" />
        <div className="relative flex h-full flex-col justify-end">
          <p className="text-xs uppercase tracking-[0.3em] text-electron/80">Cover</p>
          <h3 style={titleStyle} className={cn("mt-2 font-display tracking-tight text-foreground", titleWeightClass || "font-bold")}>
            {slide.title}
          </h3>
          {slide.bullets?.length > 0 && (
            <p style={bulletStyle} className="mt-4 text-foreground/80">
              {slide.bullets[0]}
            </p>
          )}
        </div>
        {freeform && !hideAllImages && <FreeformImages slide={slide} />}
      </div>
    );
  }

  // Aggregate gallery — primary + extras — used by every kind that can
  // display imagery. Falls back to the legacy single imageUrl when images[]
  // is empty.
  const gallery: string[] = (() => {
    if (slide.images && slide.images.length > 0) return slide.images;
    if (slide.imageUrl) return [slide.imageUrl];
    return [];
  })();
  const primaryImage = suppressKindImages ? undefined : gallery[0];
  const extraImages = suppressKindImages ? [] : gallery.slice(1);

  // Objectives: 2-column layout — numbered checklist on the left, hero
  // image on the right. Extra images stack as thumbnails underneath so the
  // user's entire gallery is visible on the slide.
  if (slide.kind === "objectives") {
    return (
      <div className={cn("relative grid aspect-video w-full grid-cols-[1.2fr_1fr] gap-6 bg-ink-900", padding, fontFamilyClass)}>
        <div className="flex min-w-0 flex-col">
          <p className="text-[10px] uppercase tracking-[0.3em] text-aurora">학습 목표</p>
          <h3 style={titleStyle} className={cn("mt-1 font-display tracking-tight text-foreground", titleWeightClass || "font-semibold")}>
            {slide.title}
          </h3>
          <div className={cn("mt-3 rounded-full bg-aurora", accentHeight, accentWidth)} />
          <ul style={bulletStyle} className="mt-5 space-y-3">
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
        {primaryImage ? (
          <div className="flex min-h-0 flex-col gap-2">
            <div className="relative flex-1 overflow-hidden rounded-xl border border-border/40">
              <img src={primaryImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
            </div>
            {extraImages.length > 0 && (
              <div className="grid shrink-0 grid-cols-3 gap-1.5">
                {extraImages.slice(0, 3).map((src, i) => (
                  <div key={i} className="relative aspect-video overflow-hidden rounded-md border border-border/40">
                    <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          !suppressKindImages && (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-border/40 text-center text-[10px] text-muted-foreground">
              갤러리에 이미지를 추가하면 여기에 표시됩니다.
            </div>
          )
        )}
        {freeform && !hideAllImages && <FreeformImages slide={slide} />}
      </div>
    );
  }

  // Summary: sunrise-tinted highlight cards with optional hero background.
  if (slide.kind === "summary") {
    return (
      <div className={cn("relative aspect-video w-full overflow-hidden bg-ink-900", fontFamilyClass)}>
        {primaryImage && (
          <>
            <img src={primaryImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
            <div className="absolute inset-0 bg-gradient-to-br from-ink-950/85 via-ink-900/70 to-ink-950/95" />
          </>
        )}
        <div className={cn("relative h-full", padding)}>
          <p className="text-[10px] uppercase tracking-[0.3em] text-sunrise">Summary</p>
          <h3 style={titleStyle} className={cn("mt-1 font-display tracking-tight text-foreground", titleWeightClass || "font-semibold")}>
            {slide.title}
          </h3>
          <div className={cn("mt-3 rounded-full bg-sunrise", accentHeight, accentWidth)} />
          <div className={cn("mt-5 grid gap-3", scale === "zoom" ? "grid-cols-2" : "grid-cols-1")}>
            {slide.bullets.map((b, i) => (
              <div
                key={i}
                className="rounded-xl border border-sunrise/30 bg-sunrise/5 p-3 text-foreground/90 backdrop-blur-sm"
              >
                <p style={bulletStyle} className="font-medium">{b}</p>
              </div>
            ))}
          </div>
          {extraImages.length > 0 && (
            <div className="absolute bottom-4 right-4 flex gap-1.5">
              {extraImages.slice(0, 3).map((src, i) => (
                <div key={i} className="relative h-12 w-16 overflow-hidden rounded-md border border-border/40 shadow-lg">
                  <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>
        {freeform && !hideAllImages && <FreeformImages slide={slide} />}
      </div>
    );
  }

  // Q&A: minimal centered layout with optional background image.
  if (slide.kind === "qna") {
    return (
      <div className={cn("relative flex aspect-video w-full flex-col items-center justify-center gap-4 overflow-hidden bg-ink-900 text-center", padding, fontFamilyClass)}>
        {primaryImage && (
          <>
            <img src={primaryImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
            <div className="absolute inset-0 bg-gradient-to-b from-ink-950/60 via-ink-950/80 to-ink-950" />
          </>
        )}
        <div className="relative flex flex-col items-center gap-4">
          <MessageCircle className={cn("text-electron", scale === "zoom" ? "h-14 w-14" : "h-7 w-7")} />
          <h3 style={titleStyle} className={cn("font-display tracking-tight text-foreground", titleWeightClass || "font-bold")}>
            {slide.title}
          </h3>
          {slide.bullets?.[0] && (
            <p style={bulletStyle} className="max-w-[80%] text-muted-foreground">{slide.bullets[0]}</p>
          )}
        </div>
        {freeform && !hideAllImages && <FreeformImages slide={slide} />}
      </div>
    );
  }

  const variant = slide.layoutVariant ?? "split-right";
  const effectiveImageUrl = suppressKindImages ? undefined : slide.imageUrl;
  const hasVisual = Boolean(slide.diagram || effectiveImageUrl);

  // Quote: centered punchline, no image.
  if (variant === "quote") {
    return (
      <div className={cn("relative flex aspect-video w-full flex-col items-center justify-center bg-ink-900 text-center", padding, fontFamilyClass)}>
        <span className={cn("font-display leading-none text-electron/80", scale === "zoom" ? "text-[180px]" : "text-[80px]")}>“</span>
        <h3 style={titleStyle} className={cn("mt-2 max-w-[80%] font-display tracking-tight text-foreground", titleWeightClass || "font-bold")}>
          {slide.title}
        </h3>
        {slide.bullets?.[0] && (
          <p style={bulletStyle} className="mt-4 max-w-[70%] text-foreground/70">
            {slide.bullets[0]}
          </p>
        )}
        {freeform && !hideAllImages && <FreeformImages slide={slide} />}
      </div>
    );
  }

  // Hero: full-bleed image with overlay text.
  if (variant === "hero" && hasVisual) {
    return (
      <div className={cn("relative aspect-video w-full overflow-hidden bg-ink-900", fontFamilyClass)}>
        {effectiveImageUrl && (
          <img src={effectiveImageUrl} alt={slide.imagePrompt ?? slide.title} className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-ink-950/20 via-ink-950/60 to-ink-950/95" />
        <div className={cn("relative flex h-full flex-col justify-end", padding)}>
          <h3 style={titleStyle} className={cn("font-display tracking-tight text-foreground", titleWeightClass || "font-bold")}>
            {slide.title}
          </h3>
          <div className={cn("mt-2 rounded-full bg-electron", accentHeight, accentWidth)} />
          <ul style={bulletStyle} className="mt-3 max-w-[70%] space-y-1 text-foreground/85">
            {slide.bullets?.slice(0, 3).map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[0.35em] h-1 w-1 shrink-0 rounded-full bg-aurora" />
                <span className="min-w-0 flex-1">{b}</span>
              </li>
            ))}
          </ul>
        </div>
        {freeform && !hideAllImages && <FreeformImages slide={slide} />}
      </div>
    );
  }

  // Stacked: text on top, wide image below.
  if (variant === "stacked") {
    return (
      <div className={cn("relative flex aspect-video w-full flex-col bg-ink-900", padding, fontFamilyClass)}>
        <h3 style={titleStyle} className={cn("font-display tracking-tight text-foreground", titleWeightClass || "font-semibold")}>
          {slide.title}
        </h3>
        <div className={cn("mt-2 rounded-full bg-electron", accentHeight, accentWidth)} />
        <ul style={bulletStyle} className="mt-3 space-y-1 text-foreground/85">
          {slide.bullets?.slice(0, 4).map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[0.35em] h-1 w-1 shrink-0 rounded-full bg-aurora" />
              <span className="min-w-0 flex-1">{b}</span>
            </li>
          ))}
        </ul>
        {hasVisual && (
          <div className="relative mt-auto h-[40%] w-full overflow-hidden rounded-xl border border-border/40">
            {slide.diagram ? (
              <DiagramRenderer code={slide.diagram} />
            ) : effectiveImageUrl ? (
              <img src={effectiveImageUrl} alt={slide.imagePrompt ?? slide.title} className="absolute inset-0 h-full w-full object-cover" />
            ) : null}
          </div>
        )}
        {freeform && !hideAllImages && <FreeformImages slide={slide} />}
      </div>
    );
  }

  // Split-left / split-right (default): image on one side, text on the other.
  const imageOnLeft = variant === "split-left";
  return (
    <div className={cn("relative aspect-video w-full bg-ink-900", padding, fontFamilyClass)}>
      <div className={cn("relative flex h-full gap-5", imageOnLeft && "flex-row-reverse")}>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 style={titleStyle} className={cn("font-display tracking-tight text-foreground", titleWeightClass || "font-semibold")}>
            {slide.title}
          </h3>
          <div className={cn("mt-3 rounded-full bg-electron", accentHeight, accentWidth)} />
          <ul style={bulletStyle} className="mt-4 space-y-1.5 text-foreground/85">
            {slide.bullets?.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[0.35em] h-1 w-1 shrink-0 rounded-full bg-aurora" />
                <span className="min-w-0 flex-1">{b}</span>
              </li>
            ))}
          </ul>
        </div>
        {hasVisual && (
          <div className="hidden w-[42%] shrink-0 flex-col gap-1.5 md:flex">
            <div className="relative flex-1 overflow-hidden rounded-xl border border-border/40">
              {slide.diagram ? (
                <DiagramRenderer code={slide.diagram} />
              ) : primaryImage ? (
                <img
                  src={primaryImage}
                  alt={slide.imagePrompt ?? slide.title}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : null}
            </div>
            {extraImages.length > 0 && (
              <div className="grid shrink-0 grid-cols-3 gap-1">
                {extraImages.slice(0, 3).map((src, i) => (
                  <div key={i} className="relative aspect-video overflow-hidden rounded-md border border-border/40">
                    <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {freeform && !hideAllImages && <FreeformImages slide={slide} />}
    </div>
  );
}

/**
 * Inline text-style editor: two scale sliders and a font-family picker.
 * Updates propagate immediately so the live preview reflects changes.
 */
function TextStyleEditor({
  value,
  onChange,
}: {
  value: SlideTextStyle;
  onChange: (next: SlideTextStyle) => void;
}) {
  const titleScale = value.titleScale ?? 1;
  const bulletScale = value.bulletScale ?? 1;
  const fontFamily = value.fontFamily ?? "display";
  const titleWeight = value.titleWeight ?? "bold";

  function patch(p: Partial<SlideTextStyle>) {
    onChange({ ...value, ...p });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-muted/30 p-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">제목 크기</span>
          <span className="font-mono text-electron">{titleScale.toFixed(2)}×</span>
        </div>
        <input
          type="range"
          min={0.7}
          max={1.6}
          step={0.05}
          value={titleScale}
          onChange={(e) => patch({ titleScale: Number(e.target.value) })}
          className="w-full accent-electron"
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">본문 크기</span>
          <span className="font-mono text-aurora">{bulletScale.toFixed(2)}×</span>
        </div>
        <input
          type="range"
          min={0.7}
          max={1.6}
          step={0.05}
          value={bulletScale}
          onChange={(e) => patch({ bulletScale: Number(e.target.value) })}
          className="w-full accent-aurora"
        />
      </div>
      <div className="space-y-1.5">
        <span className="text-[11px] text-muted-foreground">서체</span>
        <div className="grid grid-cols-3 gap-1.5">
          {(["display", "sans", "serif"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => patch({ fontFamily: f })}
              className={cn(
                "rounded-lg border px-2 py-1.5 text-[11px] font-medium transition",
                fontFamily === f
                  ? "border-electron bg-electron/10 text-electron"
                  : "border-border/60 bg-muted/30 text-foreground/80 hover:border-electron/40",
                f === "display" && "font-display",
                f === "sans" && "font-sans",
                f === "serif" && "font-serif",
              )}
            >
              {f === "display" ? "디스플레이" : f === "sans" ? "프리텐다드" : "명조"}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <span className="text-[11px] text-muted-foreground">제목 굵기</span>
        <div className="grid grid-cols-2 gap-1.5">
          {(["semibold", "bold"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => patch({ titleWeight: w })}
              className={cn(
                "rounded-lg border px-2 py-1.5 text-[11px] transition",
                titleWeight === w
                  ? "border-electron bg-electron/10 text-electron"
                  : "border-border/60 bg-muted/30 text-foreground/80 hover:border-electron/40",
                w === "semibold" ? "font-semibold" : "font-bold",
              )}
            >
              {w === "semibold" ? "보통" : "굵게"}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange({})}
        className="w-full rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:border-electron/40 hover:text-foreground"
      >
        기본값으로 초기화
      </button>
    </div>
  );
}

/**
 * Renders each image with a non-null imageLayouts entry (or the kind's
 * default slot for null entries) as an absolute-positioned static <img>.
 * Used by SlideCanvas when the slide has switched to free-form mode.
 */
function FreeformImages({ slide }: { slide: SlideData }) {
  const gallery: string[] = slide.images && slide.images.length > 0
    ? slide.images
    : slide.imageUrl ? [slide.imageUrl] : [];
  return (
    <>
      {gallery.map((src, i) => {
        const layout = slide.imageLayouts?.[i] ?? defaultLayoutForIndex(slide.kind, i);
        return (
          <div
            key={`ff-${i}-${src.slice(0, 32)}`}
            className="pointer-events-none absolute overflow-hidden rounded-lg shadow-lg"
            style={{
              left: `${layout.x * 100}%`,
              top: `${layout.y * 100}%`,
              width: `${layout.w * 100}%`,
              height: `${layout.h * 100}%`,
            }}
          >
            <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
          </div>
        );
      })}
    </>
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
          <MiniSlideThumb slide={s} />
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

/**
 * Miniature slide thumbnail that renders the full SlideCanvas (title,
 * bullets, diagram, gallery, text styling) at a fixed 960×540 virtual
 * canvas and scales it down to fit the thumbnail box via CSS container
 * queries. Keeps the thumbnail visually identical to the full slide.
 */
function MiniSlideThumb({ slide }: { slide: SlideData }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ containerType: "inline-size" } as React.CSSProperties}
    >
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{
          width: 960,
          height: 540,
          transform: "scale(calc(100cqw / 960px))",
        }}
      >
        <SlideCanvas slide={slide} scale="zoom" />
      </div>
    </div>
  );
}

function FullscreenDeck({
  slides,
  active,
  onSelect,
  onClose,
  onRequestEdit,
}: {
  slides: SlideData[];
  active: number;
  onSelect: (i: number) => void;
  onClose: () => void;
  /** Suspend fullscreen and hand the current slide off to the edit modal.
   *  The parent is expected to re-open fullscreen when the modal closes. */
  onRequestEdit?: () => void;
}) {
  // Lock body scroll + handle keyboard nav while fullscreen is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        onSelect(Math.min(slides.length - 1, active + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onSelect(Math.max(0, active - 1));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [slides.length, active, onSelect, onClose]);

  // Exit fullscreen if the browser kicks us out (e.g. F11, tab switch).
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) onClose();
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [onClose]);

  const slide = slides[active];
  if (typeof window === "undefined") return null;
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[100] flex flex-col bg-ink-950"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border/40 bg-ink-950/90 px-5 py-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5 font-mono">
            {active + 1} / {slides.length}
          </span>
          <span className="max-w-[50vw] truncate font-medium text-foreground">{slide.title}</span>
        </div>
        <div className="flex items-center gap-2">
          {onRequestEdit && (
            <button
              type="button"
              onClick={onRequestEdit}
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-electron/50 bg-electron/10 px-3 py-1 font-medium text-electron transition hover:bg-electron/20"
              title="편집 모드로 전환 · 저장 시 이 슬라이드로 돌아옵니다"
            >
              ✎ 편집
            </button>
          )}
          <button
            type="button"
            onClick={() => onSelect(Math.max(0, active - 1))}
            disabled={active === 0}
            className="focus-ring rounded-lg border border-border/60 bg-muted/40 px-3 py-1 transition hover:border-electron/40 disabled:opacity-40"
          >
            ← 이전
          </button>
          <button
            type="button"
            onClick={() => onSelect(Math.min(slides.length - 1, active + 1))}
            disabled={active >= slides.length - 1}
            className="focus-ring rounded-lg border border-border/60 bg-muted/40 px-3 py-1 transition hover:border-electron/40 disabled:opacity-40"
          >
            다음 →
          </button>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground transition hover:border-electron/50 hover:text-foreground"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-8">
        <div className="relative w-full max-w-[min(95vw,calc((100vh-8rem)*16/9))]">
          <div className="overflow-hidden rounded-3xl border border-border/40 shadow-halo">
            <SlideCanvas slide={slide} scale="zoom" />
          </div>
        </div>
      </div>
      <footer className="shrink-0 overflow-x-auto border-t border-border/40 bg-ink-950/80 px-5 py-3">
        {/*
          items-center + explicit width/height lock the 16:9 thumbnails —
          aspect-video alone collapsed to ~20px inside this flex row because
          the default align-items:stretch overrode the aspect ratio.
        */}
        <div className="flex items-center gap-2">
          {slides.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              style={{ width: 160, height: 90 }}
              className={cn(
                "relative shrink-0 overflow-hidden rounded-lg border border-border/50 bg-ink-900 transition",
                active === i && "border-electron ring-2 ring-electron/40",
              )}
              title={s.title}
            >
              <MiniSlideThumb slide={s} />
              <span className="absolute bottom-0.5 right-1 rounded bg-ink-950/80 px-1 text-[10px] font-mono text-muted-foreground">
                {i + 1}
              </span>
            </button>
          ))}
        </div>
      </footer>
    </motion.div>,
    document.body,
  );
}

function ZoomModal({
  slide,
  slideIndex,
  onClose,
}: {
  slide: SlideData;
  slideIndex: number;
  onClose: () => void;
}) {
  const updateSlide = useStudioStore((s) => s.updateSlide);

  // Local editable state — only written back to the store when the user hits
  // "적용" (Save) so an accidental close doesn't mutate the deck.
  const [title, setTitle] = useState(slide.title);
  const [bullets, setBullets] = useState<string[]>(slide.bullets ?? []);
  const [notes, setNotes] = useState(slide.notes ?? "");
  const [imagePrompt, setImagePrompt] = useState(slide.imagePrompt ?? "");
  // Canonical editable image list. Seeded from `images` when available,
  // falls back to the legacy `imageUrl` for older slides.
  const initialImages = slide.images && slide.images.length > 0
    ? slide.images
    : slide.imageUrl ? [slide.imageUrl] : [];
  const [images, setImages] = useState<string[]>(initialImages);
  // Per-image layout override (null = kind default). Sized to match images[].
  const initialLayouts: Array<ImageLayout | null> = initialImages.map(
    (_, i) => slide.imageLayouts?.[i] ?? null,
  );
  const [imageLayouts, setImageLayoutsState] = useState<Array<ImageLayout | null>>(initialLayouts);
  // Which image is currently selected for drag/preset edits.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  // Text styling overrides (size multipliers + font family).
  const initialTextStyle: SlideTextStyle = slide.textStyle ?? {};
  const [textStyle, setTextStyle] = useState<SlideTextStyle>(initialTextStyle);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const addFileInputRef = useRef<HTMLInputElement | null>(null);

  const dirty =
    title !== slide.title ||
    JSON.stringify(bullets) !== JSON.stringify(slide.bullets ?? []) ||
    notes !== (slide.notes ?? "") ||
    imagePrompt !== (slide.imagePrompt ?? "") ||
    JSON.stringify(images) !== JSON.stringify(initialImages) ||
    JSON.stringify(imageLayouts) !== JSON.stringify(initialLayouts) ||
    JSON.stringify(textStyle) !== JSON.stringify(initialTextStyle);

  // Lock body scroll while the modal is open so background doesn't jiggle.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function updateBullet(i: number, value: string) {
    setBullets((prev) => prev.map((b, idx) => (idx === i ? value : b)));
  }
  function removeBullet(i: number) {
    setBullets((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addBullet() {
    if (bullets.length >= 6) return;
    setBullets((prev) => [...prev, ""]);
  }

  // --- Image gallery ops ---------------------------------------------------

  /** Swap image + layout at the same time so positions track the image. */
  function moveImage(i: number, delta: -1 | 1) {
    const j = i + delta;
    setImages((prev) => {
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setImageLayoutsState((prev) => {
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function removeImage(i: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
    setImageLayoutsState((prev) => prev.filter((_, idx) => idx !== i));
    setSelectedIdx((cur) => (cur === i ? null : cur));
  }
  function updateLayoutAt(i: number, next: ImageLayout | null) {
    setImageLayoutsState((prev) => {
      const arr = prev.slice();
      while (arr.length <= i) arr.push(null);
      arr[i] = next;
      return arr;
    });
  }

  /** Regenerate and append (mode=add) OR replace the primary (mode=replace). */
  async function handleRegenerate(mode: "add" | "replace") {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const url = await regenerateSlideImage({
        title: title.trim() || slide.title,
        bullets: bullets.filter((b) => b.trim().length > 0),
        imagePrompt: imagePrompt.trim() || undefined,
        imageStyle: slide.imageStyle,
        kind: slide.kind,
      });
      setImages((prev) => (mode === "replace" && prev.length > 0 ? [url, ...prev.slice(1)] : [...prev, url]));
      setImageLayoutsState((prev) => {
        if (mode === "replace" && prev.length > 0) return prev; // keep existing layout for primary
        return [...prev, null];
      });
      toast.success(mode === "replace" ? "대표 이미지를 교체했습니다" : "이미지를 추가했습니다");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "이미지 생성 실패");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleAddUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      const urls = await Promise.all(Array.from(files).map((f) => imageFileToDataUrl(f)));
      setImages((prev) => [...prev, ...urls]);
      setImageLayoutsState((prev) => [...prev, ...urls.map(() => null as ImageLayout | null)]);
      toast.success(`${urls.length}장 추가됨`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "이미지 업로드 실패");
    }
  }

  function handleApply() {
    setSaving(true);
    const cleanedBullets = bullets.map((b) => b.trim()).filter((b) => b.length > 0);
    // Align layouts length with images.
    const nextLayouts: Array<ImageLayout | null> = images.map(
      (_, i) => imageLayouts[i] ?? null,
    );
    // Strip empty textStyle → undefined so it doesn't bloat storage.
    const ts = Object.values(textStyle).some((v) => v != null) ? textStyle : undefined;
    updateSlide(slideIndex, {
      title: title.trim() || slide.title,
      bullets: cleanedBullets,
      notes: notes.trim() ? notes.trim() : undefined,
      imagePrompt: imagePrompt.trim() ? imagePrompt.trim() : undefined,
      images,
      imageUrl: images[0],
      imageLayouts: nextLayouts,
      textStyle: ts,
    });
    setSaving(false);
    toast.success("슬라이드를 수정했습니다");
    onClose();
  }

  // Synthetic slide object for the live canvas preview.
  const previewSlide: SlideData = {
    ...slide,
    title: title || slide.title,
    bullets: bullets.length > 0 ? bullets : slide.bullets,
    notes,
    imagePrompt,
    images,
    imageUrl: images[0],
    imageLayouts,
    textStyle,
  };

  // In the zoom modal every image is rendered as a draggable overlay. We
  // resolve each image's effective layout from imageLayouts[i] or fall
  // back to the kind-specific default for that index so newly added
  // images appear at sensible, non-overlapping positions.
  const resolvedLayouts: ImageLayout[] = images.map(
    (_, i) => imageLayouts[i] ?? defaultLayoutForIndex(slide.kind, i),
  );
  const hasPrimaryImage = images.length > 0;

  if (typeof window === "undefined") return null;
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-ink-950/85 p-6 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="relative grid max-h-[90vh] w-full max-w-6xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-3xl border border-border/50 bg-ink-950/95 shadow-halo"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              슬라이드 {slideIndex + 1}
            </span>
            <KindBadge kind={slide.kind} />
            <span className="text-muted-foreground">편집 모드</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApply}
              disabled={!dirty || saving}
              className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-electron px-3 py-1.5 text-xs font-semibold text-background transition hover:bg-electron/90 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              적용
            </button>
            <button
              type="button"
              onClick={onClose}
              className="focus-ring flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground transition hover:border-electron/50 hover:text-foreground"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[minmax(0,3fr)_minmax(280px,1.4fr)]">
          <div
            ref={canvasRef}
            className="relative overflow-hidden bg-ink-900"
            onPointerDown={(e) => {
              // Deselect any selected image when the user clicks empty canvas.
              if (e.target === e.currentTarget) setSelectedIdx(null);
            }}
          >
            <SlideCanvas slide={previewSlide} scale="zoom" hideAllImages={hasPrimaryImage} />
            {hasPrimaryImage && images.map((src, i) => (
              <DraggableImage
                key={`${i}-${src.slice(0, 32)}`}
                src={src}
                layout={resolvedLayouts[i]}
                containerRef={canvasRef}
                interactive
                selected={selectedIdx === i}
                onSelect={() => setSelectedIdx(i)}
                onChange={(next) => updateLayoutAt(i, next)}
                alt={slide.imagePrompt ?? slide.title}
              />
            ))}
          </div>

          <div className="flex min-h-0 flex-col overflow-y-auto scrollbar-slim border-l border-border/60 bg-ink-950/60 p-5">
            <section className="space-y-2.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                제목
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="focus-ring w-full rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-sm"
                placeholder="슬라이드 제목"
              />
            </section>

            <section className="mt-5 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  내용 ({bullets.length})
                </label>
                <button
                  type="button"
                  onClick={addBullet}
                  disabled={bullets.length >= 6}
                  className="text-[11px] font-medium text-electron hover:text-electron/80 disabled:opacity-40"
                >
                  + 항목 추가
                </button>
              </div>
              <ul className="space-y-2">
                {bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-aurora" />
                    <textarea
                      value={b}
                      onChange={(e) => updateBullet(i, e.target.value)}
                      rows={2}
                      className="focus-ring flex-1 resize-none rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs leading-relaxed"
                    />
                    <button
                      type="button"
                      onClick={() => removeBullet(i)}
                      className="mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition hover:text-destructive"
                      aria-label="삭제"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-5 space-y-2.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Speaker Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="발표자 노트 (선택)"
                className="focus-ring w-full resize-none rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-xs leading-relaxed"
              />
            </section>

            {hasPrimaryImage && (
              <section className="mt-5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    이미지 배치
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedIdx == null) return;
                      updateLayoutAt(selectedIdx, null);
                    }}
                    disabled={selectedIdx == null || imageLayouts[selectedIdx] == null}
                    className="text-[11px] font-medium text-electron hover:text-electron/80 disabled:opacity-40"
                  >
                    기본 배치로 되돌리기
                  </button>
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  {selectedIdx == null
                    ? "왼쪽 프리뷰에서 수정할 이미지를 클릭하세요. 여러 이미지를 독립적으로 배치할 수 있습니다."
                    : `이미지 #${selectedIdx + 1} 선택됨 — 드래그 · 모서리 리사이즈 또는 아래 프리셋을 사용하세요.`}
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {IMAGE_LAYOUT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={selectedIdx == null}
                      onClick={() => {
                        if (selectedIdx == null) return;
                        updateLayoutAt(selectedIdx, clampLayout(preset.layout));
                      }}
                      className="rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px] font-medium text-foreground/80 transition hover:border-electron/40 hover:text-foreground disabled:opacity-40"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-5 space-y-3">
              <label className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                텍스트 스타일
              </label>
              <TextStyleEditor value={textStyle} onChange={setTextStyle} />
            </section>

            <section className="mt-5 space-y-2.5">
              <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                <ImageUp className="h-3 w-3" /> 이미지 갤러리 · 추가 / 순서 변경
              </label>
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                rows={3}
                placeholder="재생성 프롬프트 (예: 한국 고등학교 교실, 학생들이 기후 데이터 차트를 분석하는 장면, 늦은 오후 황금빛 조명)"
                className="focus-ring w-full resize-none rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-xs leading-relaxed"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleRegenerate("replace")}
                  disabled={regenerating || images.length === 0}
                  className="focus-ring flex items-center justify-center gap-1.5 rounded-xl border border-electron/50 bg-electron/10 px-2.5 py-2 text-[11px] font-semibold text-electron transition hover:bg-electron/20 disabled:opacity-40"
                >
                  {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                  대표 교체
                </button>
                <button
                  type="button"
                  onClick={() => handleRegenerate("add")}
                  disabled={regenerating}
                  className="focus-ring flex items-center justify-center gap-1.5 rounded-xl border border-aurora/50 bg-aurora/10 px-2.5 py-2 text-[11px] font-semibold text-aurora transition hover:bg-aurora/20 disabled:opacity-40"
                >
                  {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  AI 로 추가
                </button>
                <button
                  type="button"
                  onClick={() => addFileInputRef.current?.click()}
                  className="focus-ring col-span-2 flex items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-[11px] font-semibold text-foreground transition hover:border-electron/40"
                >
                  <Upload className="h-3.5 w-3.5" />
                  파일 업로드 (여러 장 가능)
                </button>
              </div>
              <input
                ref={addFileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleAddUpload(e.target.files);
                  e.currentTarget.value = "";
                }}
              />

              {images.length === 0 ? (
                <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-[11px] text-muted-foreground">
                  <ImageOff className="h-4 w-4" />
                  이미지가 없습니다. 위 버튼으로 추가하세요.
                </div>
              ) : (
                <ul className="space-y-2">
                  {images.map((src, i) => (
                    <li
                      key={`${i}-${src.slice(0, 24)}`}
                      className={cn(
                        "group flex items-center gap-2 rounded-xl border bg-ink-950/60 p-1.5 transition",
                        i === 0 ? "border-electron/50" : "border-border/60",
                      )}
                    >
                      <img src={src} alt="" className="h-16 w-28 shrink-0 rounded-lg object-cover" />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={cn("text-[10px] font-semibold uppercase tracking-[0.2em]", i === 0 ? "text-electron" : "text-muted-foreground")}>
                          {i === 0 ? "대표 이미지" : `추가 #${i}`}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {i === 0 ? "슬라이드·PPTX 에 사용됩니다" : "맨 위로 올리면 대표가 됩니다"}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveImage(i, -1)}
                          disabled={i === 0}
                          className="rounded-md p-1 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground disabled:opacity-30"
                          title="위로"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveImage(i, 1)}
                          disabled={i >= images.length - 1}
                          className="rounded-md p-1 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground disabled:opacity-30"
                          title="아래로"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
                          className="rounded-md p-1 text-muted-foreground transition hover:bg-muted/60 hover:text-destructive"
                          title="삭제"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {slide.sources && slide.sources.length > 0 && (
              <section className="mt-5 space-y-2">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-aurora">
                  <Link2 className="h-3 w-3" /> 출처
                </p>
                <ul className="space-y-0.5 text-[11px] text-foreground/80">
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
              </section>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-border/60 bg-ink-950/80 px-5 py-2.5 text-[11px] text-muted-foreground">
          <span>{dirty ? "변경사항이 있습니다 — 적용을 눌러 저장하세요." : "모든 변경이 적용되었습니다."}</span>
          <span>ESC 로 닫기</span>
        </footer>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
