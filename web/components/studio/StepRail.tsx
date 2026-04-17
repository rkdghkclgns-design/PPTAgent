"use client";

import { motion } from "framer-motion";
import { Sparkles, FileText, Palette, Layers, Download } from "lucide-react";

import { cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";
import type { GenerateEvent } from "@/lib/api";

const STEPS = [
  { key: "prompt", label: "Prompt", icon: Sparkles, matchStages: [] as GenerateEvent["stage"][] },
  { key: "research", label: "Research", icon: FileText, matchStages: ["research", "outline"] },
  { key: "design", label: "Design", icon: Palette, matchStages: ["design"] },
  { key: "render", label: "Render", icon: Layers, matchStages: ["render", "export"] },
  { key: "export", label: "Export", icon: Download, matchStages: ["upload", "done"] },
] as const;

function currentStep(events: GenerateEvent[], hasJob: boolean): string {
  if (!hasJob) return "prompt";
  const latest = events.at(-1);
  if (!latest) return "research";
  for (let i = STEPS.length - 1; i >= 0; i--) {
    if ((STEPS[i].matchStages as readonly string[]).includes(latest.stage)) return STEPS[i].key;
  }
  return "research";
}

export function StepRail() {
  const events = useStudioStore((s) => s.events);
  const hasJob = useStudioStore((s) => !!s.job);
  const progress = useStudioStore((s) => s.progress);
  const active = currentStep(events, hasJob);

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-border/60 bg-card/40 px-4 py-6 backdrop-blur-xl">
      <p className="px-2 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
        Pipeline
      </p>

      <ol className="mt-5 space-y-1">
        {STEPS.map((step, idx) => {
          const isActive = step.key === active;
          const isDone =
            STEPS.findIndex((s) => s.key === active) > idx && hasJob;
          return (
            <li key={step.key}>
              <motion.div
                layout
                className={cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                  isActive && "bg-electron/10 text-foreground",
                  !isActive && !isDone && "text-muted-foreground hover:bg-muted/40",
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
                <step.icon
                  className={cn(
                    "h-4 w-4",
                    isActive && "text-electron",
                    isDone && "text-aurora",
                  )}
                />
                <span className="font-medium tracking-tight">{step.label}</span>
                {isDone && (
                  <span className="ml-auto text-[10px] uppercase tracking-widest text-aurora">
                    done
                  </span>
                )}
              </motion.div>
            </li>
          );
        })}
      </ol>

      <div className="mt-auto rounded-2xl border border-border/60 bg-ink-900/50 p-4">
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
          {hasJob ? `${Math.round(progress * 100)}%` : "Ready"}
        </p>
      </div>
    </aside>
  );
}
