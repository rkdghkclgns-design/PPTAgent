"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { FileText, Paperclip, Play, Sparkles, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { MotionButton } from "@/components/common/MotionButton";
import { ModelSelector } from "@/components/studio/ModelSelector";
import { useStudioStore } from "@/lib/store";
import {
  createJob,
  isApiReachable,
  streamEvents,
  uploadAttachment,
  type EventStreamHandle,
} from "@/lib/api";
import { createDemoJob, runDemoJob } from "@/lib/demo";
import { cn, formatBytes } from "@/lib/utils";

const PROMPT_SUGGESTIONS = [
  "AI 스타트업 투자 유치용 10장짜리 피치덱",
  "고등학생을 위한 기후변화 수업 슬라이드",
  "Q2 프로덕트 OKR 리뷰 (차트 2개 포함)",
];

export function PromptEditor() {
  const prompt = useStudioStore((s) => s.prompt);
  const setPrompt = useStudioStore((s) => s.setPrompt);
  const attachments = useStudioStore((s) => s.attachments);
  const addAttachment = useStudioStore((s) => s.addAttachment);
  const removeAttachment = useStudioStore((s) => s.removeAttachment);
  const setJob = useStudioStore((s) => s.setJob);
  const appendEvent = useStudioStore((s) => s.appendEvent);
  const overrides = useStudioStore((s) => s.overrides);
  const pages = useStudioStore((s) => s.pages);
  const setPages = useStudioStore((s) => s.setPages);
  const job = useStudioStore((s) => s.job);

  const [submitting, setSubmitting] = useState(false);
  const streamRef = useRef<EventStreamHandle | null>(null);

  // Abort any live SSE stream when the Studio unmounts. Without this the
  // EventSource keeps firing events into the now-gone Zustand subscribers.
  useEffect(() => {
    return () => {
      streamRef.current?.abort();
      streamRef.current = null;
    };
  }, []);

  const onDrop = useCallback(
    async (files: File[]) => {
      const apiOk = await isApiReachable();
      for (const file of files) {
        if (!apiOk) {
          // Demo mode: record the attachment client-side only. The real
          // upload needs FastAPI + Supabase Storage, which aren't online yet.
          addAttachment({
            name: file.name,
            objectPath: `demo/${file.name}`,
            size: file.size,
          });
          continue;
        }
        try {
          const { object_path } = await uploadAttachment(file);
          addAttachment({
            name: file.name,
            objectPath: object_path,
            size: file.size,
          });
        } catch (err) {
          toast.error(`업로드 실패: ${file.name}`);
          console.error(err);
        }
      }
      if (!apiOk && files.length > 0) {
        toast.message("데모 모드 · 첨부 파일은 기록만 됩니다", {
          description: "실제 파싱은 FastAPI 가 연결된 뒤 수행됩니다.",
        });
      }
    },
    [addAttachment],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    maxSize: 50 * 1024 * 1024,
  });

  async function handleGenerate() {
    if (prompt.trim().length < 2) {
      toast.error("프롬프트를 입력해 주세요.");
      return;
    }
    setSubmitting(true);

    // Small helper - runs the in-browser demo stream when we can't reach a
    // real backend (or when the real backend returns anything other than 2xx).
    const fallbackToPreview = async () => {
      const demo = createDemoJob(prompt.trim());
      setJob(demo);
      await runDemoJob({
        prompt: prompt.trim(),
        jobId: demo.job_id,
        onEvent: (ev) => {
          appendEvent(ev);
          if (ev.stage === "done") toast.success("미리보기 완료");
        },
      });
    };

    const apiOk = await isApiReachable();
    if (!apiOk) {
      try {
        await fallbackToPreview();
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      const created = await createJob({
        prompt: prompt.trim(),
        attachments: attachments.map((a) => a.objectPath),
        pages: pages || undefined,
        models: overrides,
        output_name: `pptagent-${Date.now()}.pptx`,
      });
      setJob(created);
      // Replace any previous handle so reruns don't leak EventSources.
      streamRef.current?.abort();
      streamRef.current = streamEvents(
        created.job_id,
        (ev) => {
          appendEvent(ev);
          if (ev.stage === "error") toast.error(ev.error ?? ev.message);
          if (ev.stage === "done") toast.success("PPTX 생성 완료!");
        },
        (err) => {
          console.error(err);
          toast.error("이벤트 스트림 연결이 끊어졌습니다.");
        },
      );
    } catch (err) {
      // If the dedicated backend isn't wired up yet (very common in fresh
      // deploys), drop quietly into the in-browser preview stream instead
      // of shouting a red error at the user.
      console.warn("createJob failed, falling back to preview:", err);
      try {
        await fallbackToPreview();
      } catch (demoErr) {
        console.error(demoErr);
        toast.error("세션을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
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
          원하는 주제와 분량, 톤을 자유롭게 적어주세요. PDF·XLSX·이미지를 드래그해 첨부하면
          본문에 포함됩니다.
        </p>
      </header>

      <div className="glass relative rounded-3xl p-5">
        <span className="noise-layer rounded-[inherit]" />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="예: Q2 프로덕트 OKR 리뷰를 CTO 보고용으로 10장, 표지 1장 포함, 영문 30% 혼용"
          rows={6}
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

      <div
        {...getRootProps()}
        className={cn(
          "glass relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-border/70 p-5 text-center text-sm text-muted-foreground transition",
          isDragActive && "border-electron bg-electron/5 text-foreground",
        )}
      >
        <input {...getInputProps()} />
        <Paperclip className="mb-2 h-5 w-5" />
        {isDragActive ? "놓으면 업로드됩니다" : "PDF · DOCX · XLSX · 이미지 · 마크다운을 드롭하거나 클릭"}
      </div>

      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="grid gap-2 md:grid-cols-2"
          >
            {attachments.map((a) => (
              <li
                key={a.objectPath}
                className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 px-3 py-2.5"
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(a.size)}</p>
                </div>
                <button
                  onClick={() => removeAttachment(a.objectPath)}
                  className="rounded-full p-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
                  aria-label="제거"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      <div className="grid gap-2 md:grid-cols-[160px_1fr]">
        <label className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground md:self-center">
          PDF 페이지 범위
        </label>
        <input
          value={pages ?? ""}
          onChange={(e) => setPages(e.target.value || null)}
          placeholder="예: 10-12 (비워두면 전체)"
          className="focus-ring rounded-xl border border-border/60 bg-muted/40 px-3.5 py-2.5 text-sm placeholder:text-muted-foreground"
        />
      </div>

      <ModelSelector />

      <div className="mt-2 flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">
          {job ? `Job ${job.job_id}` : "Ready"}
        </span>
        <MotionButton
          onClick={handleGenerate}
          size="lg"
          disabled={submitting || !!job}
          iconLeft={<Play className="h-4 w-4" />}
        >
          {submitting ? "생성 중..." : "PPT 만들기"}
        </MotionButton>
      </div>
    </section>
  );
}
