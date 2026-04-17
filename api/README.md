# PPTAgent FastAPI Wrapper

원본 `deeppresenter/` 와 `pptagent/` 를 **수정하지 않고** 웹에서 호출할 수 있도록 얇은
REST/SSE/WebSocket 레이어를 얹은 모듈입니다.

## 요약

- `main.py` — FastAPI 앱, 라우터 등록, CORS, lifespan
- `settings.py` — pydantic-settings 기반 환경 로딩 (`api/.env`)
- `schemas.py` — 요청/응답 Pydantic 스키마
- `core/bridge.py` — `deeppresenter.main.AgentLoop` 를 감싸는 async bridge
- `core/supabase.py` — Supabase Storage + Edge Function 클라이언트
- `routes/health.py` — `/health`, `/readiness`
- `routes/models.py` — `/models` (프론트 드롭다운 카탈로그)
- `routes/generate.py` — `/generate` (POST), `/generate/{id}/events` (SSE), `/generate/ws/{id}` (WS), `/generate/attachment`

## 로컬 실행

WSL2 Ubuntu 내부에서:

```bash
cd "/mnt/c/Users/KGA-유치훈/OneDrive/바탕 화면/유치훈/디벨로켓/PPTAgent"
source .venv-wsl/bin/activate
cp api/.env.example api/.env  # 값 채우기
uvicorn api.main:app --reload --port 7870
```

## 왜 원본을 수정하지 않았나

`deeppresenter` 는 자체적으로 `config.yaml` 을 읽어 OpenAI-호환 클라이언트를 만듭니다. 우리는
그 `base_url` 을 Supabase Edge Function 주소로 주입하기만 하면 됩니다. 이 방식의 장점:

1. 원본 업스트림을 `git pull` 할 때 충돌이 없습니다.
2. Google API 키를 파이썬 프로세스가 보지 않으므로 보안이 강화됩니다.
3. Edge Function 쪽에서 모델 라우팅/속도제한/로깅을 독립적으로 개선할 수 있습니다.

## Google Imagen 기본값

`Settings.default_t2i_model = "google/imagen-3.0-generate-002"` 로 고정돼 있고, 프론트에서
요청 바디의 `models.t2i_model` 만 바꾸면 즉시 다른 Google 모델로 교체됩니다.
