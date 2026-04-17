import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";

import { NoiseBackground } from "@/components/common/NoiseBackground";
import { PromptEditor } from "@/components/studio/PromptEditor";
import { SlidePreview } from "@/components/studio/SlidePreview";
import { StepRail } from "@/components/studio/StepRail";

export const metadata: Metadata = {
  title: "Studio",
  description: "PPTAgent Studio - prompt, model routing, and live slide preview.",
};

export default function StudioPage() {
  return (
    <main className="relative min-h-screen">
      <NoiseBackground />

      <header className="flex items-center justify-between border-b border-border/60 bg-card/40 px-6 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-muted/40 transition hover:border-electron/40"
            aria-label="뒤로"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-electron/20 text-electron">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            Studio
          </div>
        </div>
        <div className="hidden items-center gap-5 text-xs text-muted-foreground md:flex">
          <span>Model routing · Google Imagen / Gemini via Supabase Edge</span>
        </div>
      </header>

      <div className="grid h-[calc(100vh-57px)] grid-cols-[auto_1fr_auto] overflow-hidden">
        <StepRail />
        <PromptEditor />
        <SlidePreview />
      </div>
    </main>
  );
}
