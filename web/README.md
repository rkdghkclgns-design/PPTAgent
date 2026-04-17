# PPTAgent Web (Next.js 14)

Dribbble-grade frontend for PPTAgent. App Router, Tailwind, shadcn/ui primitives,
Framer Motion, Zustand.

## 디자인 시스템

- **Palette**: Deep Space (`--ink-950`) 바탕, Electron Purple (`--electron`) 시그니처, Aurora (`--aurora`) 그린 보조, Sunrise (`--sunrise`) 웜 하이라이트
- **Type**: Inter (본문), JetBrains Mono (데이터·이벤트 스트림). Satoshi 변수폰트를 외부 호스팅할 경우 `--font-satoshi` 를 덮어씁니다
- **Surface**: Glassmorphism (`.glass`) + subtle noise (`.noise-layer`) + grid backdrop (`.grid-backdrop`)
- **Motion**: Framer Motion · `cubic-bezier(0.22, 1, 0.36, 1)` easing · hover = `y: -1`, tap = `scale: 0.98`
- **Layout**: Studio 는 3-pane (220px Rail / flex / 420px Preview)

## 구조

```
app/
  layout.tsx           Root shell (Inter + JetBrains Mono, Sonner toaster)
  page.tsx             Landing hero + features + pipeline
  studio/page.tsx      3-pane Studio editor
components/
  common/
    GlassCard.tsx
    MotionButton.tsx
    NoiseBackground.tsx
  studio/
    StepRail.tsx       왼쪽 파이프라인 rail
    PromptEditor.tsx   가운데 프롬프트 + 첨부 + 모델 선택
    SlidePreview.tsx   오른쪽 실시간 슬라이드 + 이벤트 로그
    ModelSelector.tsx  슬롯별 모델 드롭다운
lib/
  api.ts               FastAPI 클라이언트 (fetch + SSE + upload)
  models.ts            Google 모델 카탈로그 + 슬롯 라벨 + 기본값
  store.ts             Zustand 전역 스토어 (prompt · events · slides)
  supabase.ts          브라우저용 Supabase 클라이언트
  utils.ts             cn, formatBytes, clamp
```

## 로컬 실행

```bash
cd web
cp .env.local.example .env.local   # API 주소 + Supabase 공개 키
pnpm install   # 또는 npm install
pnpm dev       # http://localhost:3000
```

`NEXT_PUBLIC_API_ORIGIN` 이 비어 있으면 `next.config.mjs` 의 rewrite 에 의해
`/proxy/*` 가 `http://localhost:7870/*` 로 전달됩니다.

## 접근성 메모

- 모든 인터랙티브 요소는 `.focus-ring` 유틸로 `2px` electron ring 을 노출합니다.
- `prefers-reduced-motion` 사용자를 위해 애니메이션은 opacity/transform 만 사용했습니다.
- 색 대비는 WCAG AA (`--foreground` on `--background` ≥ 7:1).
