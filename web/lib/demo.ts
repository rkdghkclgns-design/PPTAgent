/**
 * Demo mode: client-only event stream that mimics the real FastAPI pipeline.
 *
 * The Studio calls `runDemoJob` when `isApiReachable()` returns false. It
 * fabricates a plausible sequence of stages so reviewers can evaluate the UI
 * without any backend. All images are picked from a small curated list of
 * Unsplash photos that already live in `next.config.mjs`'s remote allowlist.
 */

import type { GenerateEvent, GenerateJob } from "./api";

const SAMPLE_COVERS = [
  "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1483817101829-339b08e8d83f?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=1600&q=80",
];

const SLIDE_TITLES = [
  "타이틀 · 비전 선언",
  "시장 배경",
  "문제 정의",
  "솔루션 개요",
  "경쟁 포지셔닝",
  "실행 로드맵",
];

interface DemoOptions {
  prompt: string;
  onEvent: (ev: GenerateEvent) => void;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createDemoJob(prompt: string): GenerateJob {
  return {
    job_id: `demo-${Math.random().toString(36).slice(2, 10)}`,
    status: "running",
    workspace: "/demo",
    created_at: Date.now() / 1000,
  };
}

export async function runDemoJob({ prompt, onEvent }: DemoOptions): Promise<void> {
  const jobId = `demo-${Math.random().toString(36).slice(2, 10)}`;
  const emit = (ev: Omit<GenerateEvent, "job_id">) => onEvent({ job_id: jobId, ...ev });

  emit({ stage: "log", message: `demo mode: echoing "${prompt.slice(0, 40)}..."` });
  await delay(600);

  emit({ stage: "research", message: "레퍼런스 수집 및 구조 초안 작성", percent: 0.12 });
  await delay(900);

  emit({ stage: "outline", message: "6-슬라이드 목차 확정", percent: 0.24 });
  await delay(700);

  for (let i = 0; i < SLIDE_TITLES.length; i++) {
    emit({
      stage: "design",
      message: SLIDE_TITLES[i],
      percent: 0.3 + (i / SLIDE_TITLES.length) * 0.5,
      slide_index: i,
      slide_preview_url: SAMPLE_COVERS[i % SAMPLE_COVERS.length],
    });
    await delay(700 + Math.random() * 500);
  }

  emit({ stage: "render", message: "HTML → PPTX 변환", percent: 0.9 });
  await delay(700);

  emit({
    stage: "done",
    message: "데모 완료 - 실제 PPTX 는 FastAPI 가 연결된 뒤 생성됩니다",
    percent: 1,
    pptx_url: "https://github.com/rkdghkclgns-design/PPTAgent#readme",
  });
}
