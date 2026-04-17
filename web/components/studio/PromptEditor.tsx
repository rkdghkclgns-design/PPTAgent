"use client";

import { useState } from "react";
import { ImageIcon, Play, Sparkles, Wand2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { MotionButton } from "@/components/common/MotionButton";
import { ModelSelector } from "@/components/studio/ModelSelector";
import { useStudioStore } from "@/lib/store";
import { generateDeck } from "@/lib/api";
import { cn } from "@/lib/utils";

const PROMPT_SUGGESTIONS = [
  "AI 스타트업 투자 유치용 피치덱",
  "고등학생을 위한 기후변화 수업 슬라이드",
  "Q2 프로덕트 OKR 리뷰 (차트 포함)",
];

export function PromptEditor() {
  const prompt = useStudioStore((s) => s.prompt);
  const setPrompt = useStudioStore((s) => s.setPrompt);
  const slideCount = useStudioStore((s) => s.slideCount);
  const setSlideCount = useStudioStore((s) => s.setSlideCount);
  const includeImages = useStudioStore((s) => s.includeImages);
  const setIncludeImages = useStudioStore((s) => s.setIncludeImages);
  const language = useStudioStore((s) => s.language);
  const setLanguage = useStudioStore((s) => s.setLanguage);
  const overrides = useStudioStore((s) => s.overrides);

  const status = useStudioStore((s) => s.status);
  const beginJob = useStudioStore((s) => s.beginJob);
  const setSlides = useStudioStore((s) => s.setSlides);
  const updateProgress = useStudioStore((s) => s.updateProgress);
  const succeed = useStudioStore((s) => s.succeed);
  const fail = useStudioStore((s) => s.fail);

  const [submitting, setSubmitting] = useState(false);

  async function handleGenerate() {
    if (prompt.trim().length < 2) {
      toast.error("프롬프트를 입력해 주세요.");
      return;
    }
    setSubmitting(true);
    beginJob();
    updateProgress(0.1);

    // Rough progress heartbeat: Supabase call is monolithic so we fake a
    // smooth climb to 0.9 while waiting, then snap to 1.0 on success.
    const heartbeat = setInterval(() => {
      const s = useStudioStore.getState();
      if (s.progress < 0.9) useStudioStore.getState().updateProgress(s.progress + 0.03);
    }, 800);

    try {
      const result = await generateDeck({
        prompt: prompt.trim(),
        slideCount,
        includeImages,
        language,
        models: overrides,
      });
      setSlides(result.slides);
      succeed();
      toast.success(`${result.slide_count}장 슬라이드 생성 완료`);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      fail(message);
      toast.error(message);
    } finally {
      clearInterval(heartbeat);
      setSubmitting(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto scrollbar-slim p-8">
      <header>
        <span className="tag">
          <Sparkles className="h-3 w-3 text-electron" />
          프롬프트 & 설정
        </span>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-[-0.02em]">
          어떤 발표 자료가 필요하신가요?
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          주제를 자유롭게 적어주세요. 각 슬라이드의 제목·본문·참고 이미지가 함께 생성됩니다.
        </p>
      </header>

      <div className="glass relative rounded-3xl p-5">
        <span className="noise-layer rounded-[inherit]" />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="예: 공유 오피스 사업의 2026년 성장 전략을 CTO 보고용으로"
          rows={5}
          className="relative block w-full resize-none border-0 bg-transparent font-sans text-base leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="relative mt-2 flex flex-wrap gap-2">
          {PROMPT_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setPrompt(s)}
              className="tag hover:border-electron/40 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Slide count + language + images toggle */}
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="glass rounded-2xl px-5 py-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              슬라이드 수량
            </span>
            <motion.span
              key={slideCount}
              initial={{ scale: 0.85, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              className="font-display text-2xl font-semibold text-foreground"
            >
              {slideCount}장
            </motion.span>
          </div>
          <input
            type="range"
            min={3}
            max={20}
            step={1}
            value={slideCount}
            onChange={(e) => setSlideCount(Number(e.target.value))}
            className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border/70
                       accent-electron
                       [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
                       [&::-webkit-slider-thumb]:appearance-none
                       [&::-webkit-slider-thumb]:rounded-full
                       [&::-webkit-slider-thumb]:bg-electron
                       [&::-webkit-slider-thumb]:shadow-halo"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>3장</span>
            <span>20장</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:w-56">
          <label className="glass flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 transition hover:border-electron/40">
            <span className="flex items-center gap-2 text-sm">
              <ImageIcon className="h-4 w-4 text-aurora" />
              참고 이미지 포함
            </span>
            <span
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition",
                includeImages ? "bg-electron" : "bg-muted",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={includeImages}
                onChange={(e) => setIncludeImages(e.target.checked)}
              />
              <span
                className={cn(
                  "absolute h-4 w-4 rounded-full bg-white shadow transition",
                  includeImages ? "left-4" : "left-0.5",
                )}
              />
            </span>
          </label>

          <div className="glass flex items-center justify-between rounded-2xl px-4 py-3 text-sm">
            <span className="text-muted-foreground">언어</span>
            <div className="flex gap-1 rounded-full bg-muted/40 p-1">
              {(["ko", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition",
                    language === lang
                      ? "bg-electron text-white shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {lang === "ko" ? "한국어" : "English"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ModelSelector />

      <div className="mt-2 flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">
          {status === "running" ? "생성 중..." : status === "succeeded" ? "완료" : "준비"}
        </span>
        <MotionButton
          onClick={handleGenerate}
          size="lg"
          disabled={submitting}
          iconLeft={submitting ? <Wand2 className="h-4 w-4 animate-pulse" /> : <Play className="h-4 w-4" />}
        >
          {submitting ? "생성 중..." : `${slideCount}장 PPT 만들기`}
        </MotionButton>
      </div>
    </section>
  );
}
