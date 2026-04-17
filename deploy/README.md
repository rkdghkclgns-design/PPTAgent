# Deployment

## 로컬 풀스택 (Docker Compose)

```bash
# 1. Supabase 엣지 펑션 먼저 배포
cd supabase
supabase link --project-ref <ref>
supabase functions deploy llm-proxy
supabase secrets set GOOGLE_API_KEY=<key>

# 2. 환경파일 준비
cp ../api/.env.example ../api/.env      # 값 채우기
cp ../web/.env.local.example ../web/.env.local

# 3. 풀스택 기동 (WSL2 또는 Docker Desktop 켜진 Windows)
cd ..
docker compose -f deploy/docker-compose.prod.yml up -d --build
# 프론트 → http://localhost:3000
# API   → http://localhost:7870/readiness
```

## Railway (API 전용)

프론트는 Vercel 로, API 는 Railway 로 분리하는 구성이 권장됩니다.

```bash
railway init
railway link <project>
railway up --detach
# Dashboard → Variables 에 api/.env.example 값 주입
```

`deploy/railway.json` 은 Railway 가 자동 인식합니다. `DOCKER_HOST` 를
별도 제공해 샌드박스 컨테이너 실행을 위임하세요.

## Fly.io (API 전용)

```bash
fly launch --copy-config --config deploy/fly.toml --now
fly secrets set $(cat api/.env | xargs)
```

> 샌드박스가 필요한 경로(이미지 생성, 브라우저 렌더)는 fly 머신 CPU/메모리를
> 넉넉히 줍니다. 권장: `shared-cpu-2x / 2GB` 이상.

## Vercel (프론트)

```bash
cd web
vercel link
vercel env add NEXT_PUBLIC_API_ORIGIN          # Railway/Fly 의 API URL
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel --prod
```

## 환경변수 요약

| 변수 | 배치 | 설명 |
|------|------|------|
| `GOOGLE_API_KEY` | **Supabase Secret** | Google Imagen/Gemini 호출 유일 키 |
| `SUPABASE_URL` | api + web | 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | api (서버) | Edge Function 호출 및 Storage 업로드 |
| `SUPABASE_ANON_KEY` | web | 브라우저 클라이언트 |
| `SUPABASE_EDGE_FUNCTION_URL` | api | `https://<ref>.supabase.co/functions/v1/llm-proxy` |
| `NEXT_PUBLIC_API_ORIGIN` | web | FastAPI 공개 URL |

## 헬스체크

| 엔드포인트 | 기대값 |
|-----------|-------|
| `GET /health` | `{ "status": "ok" }` |
| `GET /readiness` | 모든 bool 필드가 `true` |
| `GET /models` | Google 모델 배열 + `defaults.t2i_model = "google/imagen-3.0-generate-002"` |
