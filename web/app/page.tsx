import Link from "next/link";
import { ArrowUpRight, Sparkles, Wand2, LayoutTemplate, Image as ImageIcon, Rocket } from "lucide-react";

import { GlassCard } from "@/components/common/GlassCard";
import { MotionButton } from "@/components/common/MotionButton";
import { NoiseBackground } from "@/components/common/NoiseBackground";

export default function HomePage() {
  return (
    <main className="relative min-h-screen">
      <NoiseBackground />

      {/* Top nav */}
      <header className="container flex h-20 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-electron/20 text-electron">
            <span className="absolute inset-0 rounded-xl bg-electron/40 blur-xl" />
            <Sparkles className="relative h-4 w-4" />
          </span>
          PPTAgent Studio
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#features" className="transition hover:text-foreground">기능</a>
          <a href="#pipeline" className="transition hover:text-foreground">파이프라인</a>
          <a href="https://github.com/icip-cas/PPTAgent" className="transition hover:text-foreground">GitHub</a>
        </nav>
        <Link href="/studio">
          <MotionButton size="sm" iconRight={<ArrowUpRight className="h-4 w-4" />}>Studio 시작</MotionButton>
        </Link>
      </header>

      {/* Hero */}
      <section className="container pt-10 pb-24 md:pt-24">
        <div className="mx-auto max-w-5xl text-center">
          <span className="tag mx-auto animate-fade-up">
            <span className="h-1.5 w-1.5 rounded-full bg-aurora animate-breathing" />
            Multi-agent · Deep Research · Free-form Design
          </span>

          <h1 className="mt-6 font-display text-display-md leading-[1.02] tracking-[-0.035em] md:text-display-xl">
            <span className="text-gradient">프롬프트 한 줄</span>로<br />
            발표 자료 전체를 설계합니다.
          </h1>

          <p className="mx-auto mt-8 max-w-2xl text-balance text-lg text-muted-foreground">
            PPTAgent 의 멀티 에이전트 루프에 Dribbble 수준의 인터페이스를 얹었습니다.
            Gemini 3.1 Flash Image 가 커버를, Gemini 2.5 가 구조를 맡고, Supabase Edge Function 이
            API 키를 안전하게 보관합니다.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/studio">
              <MotionButton size="lg" iconRight={<Wand2 className="h-4 w-4" />}>
                지금 만들어보기
              </MotionButton>
            </Link>
            <a href="#pipeline" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
              작동 방식 보기 →
            </a>
          </div>
        </div>

        {/* Hero card preview */}
        <div className="relative mx-auto mt-20 max-w-6xl">
          <div className="pointer-events-none absolute inset-x-0 -top-10 mx-auto h-64 w-3/4 rounded-full bg-electron/25 blur-3xl" />
          <GlassCard elevated className="p-0">
            <div className="grid gap-0 md:grid-cols-[280px_1fr_340px]">
              <div className="border-b border-border/60 p-5 md:border-b-0 md:border-r">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">1 · Research</p>
                <p className="mt-3 font-medium">자료 수집 · 문맥 이해</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  PDF·XLSX·Markdown 을 MinerU 로 파싱하고 개요를 구성합니다.
                </p>
              </div>
              <div className="border-b border-border/60 p-5 md:border-b-0 md:border-r">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">2 · Design</p>
                <p className="mt-3 font-medium">HTML 기반 자유형 레이아웃</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Gemini 2.5 Pro 가 슬라이드 HTML 을 직접 설계하고 피드백 루프를 돕니다.
                </p>
              </div>
              <div className="p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">3 · Export</p>
                <p className="mt-3 font-medium">PPTX · Supabase Storage</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  브라우저 렌더 후 html2pptx 로 네이티브 PPTX 를 생성, 서명된 URL 로 즉시 공유.
                </p>
              </div>
            </div>
          </GlassCard>
        </div>
      </section>

      {/* Features grid */}
      <section id="features" className="container py-24">
        <div className="max-w-2xl">
          <p className="tag">Design System</p>
          <h2 className="mt-4 font-display text-display-sm tracking-[-0.02em]">
            발표 자료를 만드는, <span className="text-gradient">가장 미려한 도구</span>.
          </h2>
          <p className="mt-4 text-muted-foreground">
            3-pane Creative Suite 레이아웃, Deep Space 팔레트, 퍼플 글로우. 모든 디테일이
            Dribbble 1차 피드의 기준에 맞춰 정돈돼 있습니다.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <GlassCard interactive>
            <LayoutTemplate className="h-5 w-5 text-electron" />
            <h3 className="mt-5 text-lg font-semibold">3-pane Studio</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              좌측 Step Rail · 중앙 Prompt Editor · 우측 실시간 Slide Preview. 어떤 단계든
              문맥 이탈 없이 이동할 수 있습니다.
            </p>
          </GlassCard>
          <GlassCard interactive>
            <ImageIcon className="h-5 w-5 text-aurora" />
            <h3 className="mt-5 text-lg font-semibold">나노바나나 차세대 생성</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Gemini 3.1 Flash Image (preview · 나노바나나 차세대) 로 모든 슬라이드 이미지를
              하드 핀 한 단일 모델로 생성해 톤·디테일을 균일하게 유지합니다.
            </p>
          </GlassCard>
          <GlassCard interactive>
            <Rocket className="h-5 w-5 text-sunrise" />
            <h3 className="mt-5 text-lg font-semibold">Supabase Edge 프록시</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Google API 키는 Edge Function Secret 에만 존재합니다. 프론트·FastAPI 는
              키를 절대 보지 못합니다.
            </p>
          </GlassCard>
        </div>
      </section>

      {/* Pipeline diagram */}
      <section id="pipeline" className="container py-24">
        <GlassCard elevated className="overflow-hidden">
          <div className="grid gap-8 md:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="tag">Pipeline</p>
              <h2 className="mt-4 font-display text-display-sm tracking-[-0.02em]">
                브라우저에서 PPTX 까지.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Next.js 가 프롬프트와 모델 선택을 FastAPI 에 전달하면, FastAPI 는 Docker
                샌드박스 안의 PPTAgent AgentLoop 를 실행합니다. 모든 LLM 호출은 Supabase
                Edge Function 을 거쳐 Google 로 향하고, 결과 PPTX 는 Supabase Storage 의
                서명된 URL 로 즉시 다운로드할 수 있습니다.
              </p>
            </div>
            <div className="relative isolate">
              <pre className="overflow-x-auto rounded-2xl bg-ink-900/70 p-5 text-xs leading-relaxed text-muted-foreground">
{`Next.js  ── REST ─▶  FastAPI ── spawn ─▶  AgentLoop (Docker)
   ▲                     │
   │                     ▼
   └── SSE ◀── events ── WSL2 host
                        │
                        ▼
           ┌──────────────────────────────┐
           │ Supabase Edge Functions      │
           │  ├─ generate (Gemini 2.5)    │
           │  └─ regenerate-image         │
           │     └─ Gemini 3.1 Flash Img  │
           └──────────────────────────────┘`}
              </pre>
            </div>
          </div>
        </GlassCard>
      </section>

      <footer className="container flex flex-col items-start justify-between gap-6 border-t border-border/60 py-10 text-sm text-muted-foreground md:flex-row md:items-center">
        <p>© 2026 PPTAgent Studio · built on icip-cas/PPTAgent</p>
        <div className="flex gap-5">
          <a href="https://github.com/icip-cas/PPTAgent" className="hover:text-foreground">GitHub</a>
          <a href="/studio" className="hover:text-foreground">Studio</a>
        </div>
      </footer>
    </main>
  );
}
