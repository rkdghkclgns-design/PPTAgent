"use client";

import { motion } from "framer-motion";
import { Check, Download, FileText, Palette, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";

const STEPS = [
  { key: "prompt", label: "Prompt", icon: Sparkles },
  { key: "outline", label: "Outline", icon: FileText },
  { key: "design", label: "Design", icon: Palette },
  { key: "export", label: "Export", icon: Download },
] as const;

export function StepRail() {
  const status = useStudioStore((s) => s.status);
  const progress = useStudioStore((s) => s.progress);
  const slides = useStudioStore((s) => s.slides);

  const activeKey: (typeof STEPS)[number]["key"] =
    status === "succeeded"
      ? "export"
      : status === "running"
        ? progress < 0.4
          ? "outline"
          : "design"
        : status === "failed"
          ? "prompt"
          : "prompt";
  const activeIdx = STEPS.findIndex((s) => s.key === activeKey);

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-border/60 bg-card/40 px-4 py-6 backdrop-blur-xl">
      <p className="px-2 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
        Pipeline
      </p>

      <ol className="mt-5 space-y-1">
        {STEPS.map((step, idx) => {
          const isActive = idx === activeIdx;
          const isDone = idx < activeIdx || status === "succeeded";
          return (
            <li key={step.key}>
              <motion.div
                layout
                className={cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                  isActive && "bg-electron/10 text-foreground",
                  !isActive && !isDone && "text-muted-foreground",
                  isDone && "text-foreground",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="rail-indicator"
                    className="absolute left-0 h-5 w-[3px] rounded-full bg-electron"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                {isDone ? (
                  <Check className="h-4 w-4 text-aurora" />
                ) : (
                  <step.icon
                    className={cn("h-4 w-4", isActive && "text-electron")}
                  />
                )}
                <span className="font-medium tracking-tight">{step.label}</span>
              </motion.div>
            </li>
          );
        })}
      </ol>

      <div className="mt-auto space-y-3">
        <div className="rounded-2xl border border-border/60 bg-ink-900/50 p-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Progress
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border/70">
            <motion.div
              className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--electron))_0%,hsl(var(--aurora))_100%)]"
              animate={{ width: `${Math.round(progress * 100)}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 24 }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {status === "running"
              ? `${Math.round(progress * 100)}%`
              : status === "succeeded"
                ? "완료"
                : status === "failed"
                  ? "실패"
                  : "대기"}
          </p>
        </div>

        {slides.length > 0 && (
          <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{slides.length}장</span> 생성됨
          </div>
        )}
      </div>
    </aside>
  );
}
