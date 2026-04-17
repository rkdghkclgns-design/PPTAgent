# Supabase Layer

This folder holds everything that lives on Supabase: the `llm-proxy` Edge Function and the Storage buckets the FastAPI backend writes PPTX files into.

## 기존 Supabase 프로젝트 이용

이 레포는 **기존 Supabase 프로젝트에 붙는 형태**로 설계돼 있습니다. 새 프로젝트를 만들 필요는 없고, 다음 두 가지만 확인하세요.

1. Edge Functions 가 enabled 되어 있는지 (기본 활성).
2. Storage 에 `presentations` 버킷이 있는지. 없으면 콘솔에서 프라이빗 버킷으로 1개만 생성.

## 설치

```bash
# Supabase CLI (scoop 또는 npm global)
scoop install supabase
# 또는
npm install -g supabase

# 프로젝트 연결 (project-ref 는 Supabase 대시보드의 Settings → General 에서 확인)
cd supabase
supabase link --project-ref <YOUR_PROJECT_REF>

# Edge Function 배포
supabase functions deploy llm-proxy --no-verify-jwt
# (인증이 필요한 경우 --no-verify-jwt 옵션 제거)

# 시크릿 등록 (Google API 키는 여기에만 둠)
supabase secrets set GOOGLE_API_KEY="AIza..." --project-ref <YOUR_PROJECT_REF>
```

## 호출 예시

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/llm-proxy \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "google/gemini-2.0-flash",
    "messages": [{"role":"user","content":"Hello"}]
  }'
```

Imagen (기본 T2I 모델):

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/llm-proxy \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "google/imagen-3.0-generate-002",
    "prompt": "a minimal cover illustration for a quarterly report",
    "aspect_ratio": "16:9"
  }'
```

응답은 OpenAI 호환 형태이므로 `deeppresenter` 의 `apis.py` 가 그대로 소비합니다.

## 지원 모델 목록 (기본값은 Imagen)

| id | 종류 | 용도 |
|----|-----|-----|
| `google/imagen-3.0-generate-002` | image | **기본 t2i_model** |
| `google/imagen-3.0-fast-generate-001` | image | 빠른 초안 |
| `google/gemini-2.0-flash` | chat | research_agent 기본 |
| `google/gemini-2.0-flash-exp` | chat | 실험 |
| `google/gemini-2.5-pro` | chat | design_agent 고품질 |
| `google/gemini-2.5-flash` | chat | 긴 문맥 |
| `google/gemini-2.0-flash-vision` | vision | vision_model |

프론트엔드의 모델 선택 드롭다운은 [web/lib/models.ts](../web/lib/models.ts) 에서 관리합니다.
