# PPTAgent Web Integration

> Korean-first integration layer that wraps `deeppresenter/` + `pptagent/` with a FastAPI backend, a Next.js 14 frontend (Dribbble-style), and a Supabase Edge Function that proxies all Google API calls.

## 레이아웃

```
PPTAgent/
├── deeppresenter/        # 원본 런타임 (수정 없음)
├── pptagent/             # 원본 레거시 (수정 없음)
├── api/                  # FastAPI 래퍼 → deeppresenter.main.AgentLoop 노출
│   ├── main.py           # /health, /models, /generate (SSE), /generate/ws (WebSocket)
│   ├── core/
│   │   ├── bridge.py     # AgentLoop 호출 브리지
│   │   ├── supabase.py   # Supabase Edge Function 호출
│   │   └── storage.py    # PPTX 파일 Supabase Storage 업로드
│   ├── routes/
│   │   ├── generate.py
│   │   ├── models.py
│   │   └── health.py
│   └── Dockerfile
│
├── web/                  # Next.js 14 App Router + Tailwind + shadcn/ui + Framer Motion
│   ├── app/
│   │   ├── page.tsx              # 랜딩
│   │   ├── studio/page.tsx       # 3-pane 에디터
│   │   ├── layout.tsx
│   │   └── globals.css           # Dribbble-style design tokens
│   ├── components/
│   │   ├── studio/*              # Step Rail · Prompt · Preview · Model Selector · Progress
│   │   └── common/*              # GlassCard · NoiseBackground · MotionButton
│   └── lib/
│       ├── api.ts                # FastAPI 클라이언트 (fetch + EventSource + WebSocket)
│       ├── supabase.ts
│       └── models.ts             # 모델 카탈로그 (기본값: google/imagen)
│
├── supabase/
│   └── functions/
│       └── llm-proxy/
│           └── index.ts          # Deno Edge Function: 모델별 라우팅 (Gemini 텍스트/비전, Imagen T2I)
│
└── deploy/
    ├── docker-compose.prod.yml
    ├── railway.json
    └── fly.toml
```

## 아키텍처

```
┌────────────────────┐   HTTPS    ┌─────────────────────┐  HTTPS   ┌────────────────────┐
│  Next.js (Vercel)  │ ──REST──→  │  FastAPI (Railway)  │ ──call→  │ Supabase Edge Fn   │
│  Dribbble UI       │ ──SSE/WS─→ │  AgentLoop wrapper  │ ←stream─ │ llm-proxy          │
│  Model Selector    │            │  PPTX → Storage     │          │ Gemini / Imagen    │
└────────────────────┘            └─────────────────────┘          └────────────────────┘
                                           │
                                           ▼
                                  ┌──────────────────┐
                                  │ Docker Sandbox   │
                                  │ (deeppresenter-  │
                                  │  sandbox 이미지)  │
                                  └──────────────────┘
```

## 환경변수

| 이름 | 설명 | 배치 위치 |
|------|------|----------|
| `SUPABASE_URL` | 프로젝트 URL | `api/` + `web/` |
| `SUPABASE_ANON_KEY` | 클라이언트 anon 키 | `web/` |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 service role 키 | `api/` |
| `SUPABASE_EDGE_FUNCTION_URL` | llm-proxy 엔드포인트 | `api/` |
| `GOOGLE_API_KEY` | Gemini/Imagen 공용 키 | **Supabase Edge Function Secrets 에만** |
| `DEEPPRESENTER_WORKSPACE_BASE` | PPTX 임시 저장 경로 | `api/` |

⚠️ **Google API 키는 프론트나 FastAPI에 절대 두지 말 것.** Supabase Edge Function Secrets 로만 주입하고, FastAPI 는 해당 Edge Function 에만 요청을 보냅니다.

## 실행 순서 (로컬)

```bash
# 1. WSL2 Ubuntu 안에서
curl -LsSf https://astral.sh/uv/install.sh | sh
uv pip install -e .
playwright install-deps && playwright install chromium
npm install --prefix deeppresenter/html2pptx

# 2. Docker Desktop (Windows) 가 실행 중일 것
docker pull forceless/deeppresenter-sandbox
docker tag forceless/deeppresenter-sandbox deeppresenter-sandbox

# 3. Supabase Edge Function 배포
supabase functions deploy llm-proxy --project-ref <YOUR_REF>
supabase secrets set GOOGLE_API_KEY=<key> --project-ref <YOUR_REF>

# 4. FastAPI 백엔드
cd api && uv pip install -r requirements.txt && uvicorn main:app --reload --port 7870

# 5. Next.js 프론트엔드
cd web && pnpm install && pnpm dev  # http://localhost:3000
```

## 클라우드 배포

- **프론트**: Vercel (web/ 서브디렉토리)
- **백엔드**: Railway 또는 Fly.io (api/Dockerfile)
- **Edge Function**: Supabase (supabase/functions/llm-proxy)
- **스토리지**: Supabase Storage 의 `presentations` 버킷 (PPTX)

자세한 배포는 [deploy/README.md](deploy/README.md) 참고.
