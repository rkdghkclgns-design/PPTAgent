# PPTAgent 웹 통합 셋업 가이드 (Windows / WSL2)

> **현재 상태**: 클론 완료 · Docker Desktop 설치 완료 (재부팅/실행 필요) · WSL2 Ubuntu 준비됨 · api/web/supabase 통합 레이어 작성 완료.

이 문서는 로컬에서 첫 PPT 가 만들어질 때까지의 **남은 수동 단계**만 다룹니다. 자동화가 가능한 부분은 이미 끝내뒀습니다.

---

## 0. 이미 완료된 것 (자동화 영역)

| 항목 | 상태 |
|------|------|
| 레포 클론 | ✅ |
| Docker Desktop 설치 (winget) | ✅ (Windows 재시작/실행 필요) |
| WSL2 Ubuntu 24.04 | ✅ |
| uv 설치 (WSL) | ✅ |
| FastAPI 래퍼 (`api/`) | ✅ |
| Next.js 프론트엔드 (`web/`) | ✅ |
| Supabase Edge Function (`supabase/functions/llm-proxy/`) | ✅ |
| Dribbble-style 디자인 시스템 | ✅ |
| 배포 설정 (Docker Compose, Railway, Fly.io) | ✅ |

---

## 1. Docker Desktop 실행

Docker Desktop 이 `winget` 으로 설치되었습니다. 지금:

1. Windows 시작메뉴에서 **Docker Desktop** 실행
2. 최초 실행 시 "WSL 2 integration" 동의
3. Settings → Resources → WSL Integration 에서 **Ubuntu** 토글 ON
4. 트레이 아이콘이 녹색이 될 때까지 대기 (2~3분)

확인:

```powershell
docker --version
wsl -d Ubuntu -- docker ps
```

---

## 2. WSL2 안에서 시스템 의존성

WSL 세션을 열고 다음을 한 번만 실행:

```bash
# WSL Ubuntu 셸
sudo apt update
sudo apt install -y build-essential python3-dev python3.12-venv \
                    libxml2-dev libxslt1-dev libmagic1 poppler-utils \
                    fonts-noto-cjk curl git
```

Node.js (WSL 쪽에는 없음):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 3. PPTAgent 의존성 재설치

`fasttext` 빌드를 위해 build-essential 이 먼저 있어야 합니다.

```bash
cd "/mnt/c/Users/KGA-유치훈/OneDrive/바탕 화면/유치훈/디벨로켓/PPTAgent"
source .venv-wsl/bin/activate      # 이미 만들어져 있음

uv pip install -e .                # 이번엔 fasttext 가 빌드됩니다
uv pip install -r api/requirements.txt

# Playwright + Chromium
playwright install-deps
playwright install chromium

# html2pptx (Node)
npm install --prefix deeppresenter/html2pptx

# 언어 판별 모델
uv pip install modelscope
modelscope download forceless/fasttext-language-id
```

---

## 4. Docker 샌드박스 이미지

```bash
# Docker Desktop 이 실행 중일 때 (WSL 통합 ON)
docker pull forceless/deeppresenter-sandbox
docker tag forceless/deeppresenter-sandbox deeppresenter-sandbox
docker images | grep deeppresenter
```

---

## 5. Supabase 엣지 펑션 배포

Supabase CLI 가 없다면:

```bash
npm install -g supabase
```

기존 Supabase 프로젝트에 연결 + 배포:

```bash
cd "/mnt/c/Users/KGA-유치훈/OneDrive/바탕 화면/유치훈/디벨로켓/PPTAgent/supabase"

supabase login                                         # 최초 1회
supabase link --project-ref <YOUR_PROJECT_REF>
supabase functions deploy llm-proxy --no-verify-jwt
supabase secrets set GOOGLE_API_KEY="AIza..." --project-ref <YOUR_PROJECT_REF>
```

`presentations` 버킷이 없다면 Supabase 대시보드 Storage 에서 **프라이빗** 으로 1 개만 생성.

---

## 6. 환경변수 파일 작성

### api/.env

```bash
cp api/.env.example api/.env
```

채워야 할 값:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_EDGE_FUNCTION_URL` = `https://<ref>.supabase.co/functions/v1/llm-proxy`

### web/.env.local

```bash
cp web/.env.local.example web/.env.local
```

채워야 할 값:
- `NEXT_PUBLIC_API_ORIGIN` = `http://localhost:7870`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 7. 로컬 실행 (2 개 터미널)

### 터미널 A — FastAPI (WSL)

```bash
cd "/mnt/c/Users/KGA-유치훈/OneDrive/바탕 화면/유치훈/디벨로켓/PPTAgent"
source .venv-wsl/bin/activate
uvicorn api.main:app --reload --port 7870
```

헬스체크: http://localhost:7870/readiness → 모든 필드 `true`

### 터미널 B — Next.js (Windows PowerShell 또는 WSL)

```bash
cd web
npm install          # 최초 1회, 5분 정도 소요
npm run dev
```

브라우저: http://localhost:3000 (랜딩) → http://localhost:3000/studio (에디터)

---

## 8. 동작 확인

1. 랜딩에서 **Studio 시작** 클릭
2. 프롬프트 입력: `"AI 스타트업 피치덱 10장, CTO 대상"`
3. 우측 드롭다운에서 **이미지 생성 = Imagen 3.0 (Standard)**, **디자인 = Gemini 2.5 Pro** 확인 (기본값)
4. **PPT 만들기** 클릭
5. 좌측 Rail 이 Research → Design → Render → Export 로 진행
6. 우측 프리뷰에 슬라이드 썸네일이 순차 표시
7. 완료 시 우상단 **PPTX** 버튼으로 다운로드 (Supabase Storage 의 서명된 URL)

---

## 9. 클라우드 배포

상세는 [deploy/README.md](deploy/README.md) 참고. 요약:

| 컴포넌트 | 플랫폼 | 주 명령 |
|---------|-------|--------|
| 프론트 | Vercel | `cd web && vercel --prod` |
| API    | Railway | `railway up` (루트에서) |
| API (대안) | Fly.io | `fly launch --config deploy/fly.toml` |
| Edge Fn | Supabase | 이미 5단계에서 완료 |
| 풀스택 | 자체 서버 | `docker compose -f deploy/docker-compose.prod.yml up -d` |

---

## 10. 자주 막히는 지점

| 증상 | 원인 | 해결 |
|-----|------|-----|
| `fasttext` wheel 빌드 실패 | `build-essential`, `python3.12-dev` 부재 | 2단계 재실행 |
| `docker: command not found` (WSL) | Docker Desktop WSL 통합 미활성 | 1단계 Settings → Resources → WSL Integration |
| Playwright `chromium-browser` 없음 | `--with-deps` 플래그 없이 설치 | `playwright install --with-deps chromium` |
| FastAPI `readiness` 에 `deeppresenter_importable: false` | 3단계가 미완료 | `uv pip install -e .` 재시도 |
| Edge Function 401 | JWT verify 활성, 서비스롤 키 불일치 | `--no-verify-jwt` 로 재배포 또는 키 재확인 |
| 프론트 CORS 오류 | `CORS_ORIGINS` 에 URL 누락 | `api/.env` 의 `CORS_ORIGINS` 에 추가 |

---

## 11. 다음에 건드리면 좋은 것

- `api/core/bridge.py` 의 `progress_hook` 을 `deeppresenter` 의 실제 이벤트 포인트에 연결 (현재는 래퍼 레벨 이벤트)
- `web/components/studio/SlidePreview.tsx` 의 썸네일 grid 를 드래그로 재정렬
- Supabase Edge Function 에 **레이트 리밋 + 캐싱** 추가 (같은 프롬프트 재요청 시 비용 절감)
- OAuth (Google/GitHub) 를 Supabase Auth 로 추가해 Studio 를 보호
