# GitHub Actions · Secrets checklist

워크플로 4개가 정상 동작하려면 아래 시크릿이 **Repository → Settings → Secrets and variables → Actions** 에 등록돼야 합니다.

## 한눈에 보기

| Secret | 사용 워크플로 | 획득 방법 |
|--------|--------------|-----------|
| `VERCEL_TOKEN` | deploy-web | https://vercel.com/account/tokens |
| `VERCEL_ORG_ID` | deploy-web | `vercel link` 후 `web/.vercel/project.json` → `orgId` |
| `VERCEL_PROJECT_ID` | deploy-web | 동일 파일 → `projectId` |
| `NEXT_PUBLIC_API_ORIGIN` | deploy-web | 예) `https://pptagent-api.fly.dev` |
| `NEXT_PUBLIC_SUPABASE_URL` | deploy-web | Supabase 대시보드 → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | deploy-web | 동일 |
| `FLY_API_TOKEN` | deploy-api | `fly auth token` (fly CLI) |
| `SUPABASE_ACCESS_TOKEN` | deploy-supabase | https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF` | deploy-supabase | 프로젝트 URL 의 8-char ref |
| `GITHUB_TOKEN` | 모든 워크플로 | 자동 발급 (조치 불필요) |

## Google API 키는 시크릿에 두지 않습니다

Google Imagen/Gemini 키는 **Supabase Edge Function Secret** 에만 저장합니다. 이유:

1. GitHub Actions 에 두면 로그/캐시/포크에 유출될 위험이 높아집니다.
2. Edge Function 은 키를 런타임에만 프로세스에 주입하므로 버전 관리 기록에 남지 않습니다.
3. 키 로테이션을 Supabase 대시보드에서 한 곳에서 처리할 수 있습니다.

등록:

```bash
supabase secrets set GOOGLE_API_KEY="AIza..." --project-ref <ref>
```

## gh CLI 로 한 번에 등록

레포 루트에서:

```bash
# 1. 로그인 확인 (rkdghkclgns-design 계정)
gh auth status

# 2. .env.gh-secrets 파일을 만든 뒤 (커밋 절대 금지)
cat > .env.gh-secrets <<'EOF'
VERCEL_TOKEN=...
VERCEL_ORG_ID=team_...
VERCEL_PROJECT_ID=prj_...
NEXT_PUBLIC_API_ORIGIN=https://pptagent-api.fly.dev
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
FLY_API_TOKEN=fo1_...
SUPABASE_ACCESS_TOKEN=sbp_...
SUPABASE_PROJECT_REF=xxxx
EOF

# 3. 일괄 업로드 후 파일 삭제
while IFS='=' read -r k v; do
  [[ -z "$k" || "$k" =~ ^# ]] && continue
  gh secret set "$k" --body "$v"
done < .env.gh-secrets
shred -u .env.gh-secrets 2>/dev/null || rm -f .env.gh-secrets
```

## Environments

`deploy-web.yml` 와 `deploy-api.yml` 는 `production` · `preview` 환경을 참조합니다.
GitHub 에서 **Settings → Environments → New environment** 로 두 개를 미리 만들어 두고,
`production` 에는 required reviewer 를 지정하면 수동 승인 후 배포되도록 바꿀 수 있습니다.

## PR 미리보기

`deploy-web.yml` 은 PR 열릴 때 preview 배포 후 PR 바디에 URL 을 코멘트로 달아줍니다.
`deploy-api.yml` 은 PR 에서는 이미지를 빌드만 하고 push/deploy 는 하지 않습니다.

## 워크플로 발동 조건 요약

| 워크플로 | 트리거 |
|---------|-------|
| `ci-web-api.yml` | `api/**`, `web/**`, `supabase/**` 가 포함된 PR/push |
| `deploy-web.yml` | `web/**` push → 프로덕션, PR → 프리뷰, manual dispatch |
| `deploy-api.yml` | `api/**`, `deeppresenter/**`, `pptagent/**` push → GHCR + Fly |
| `deploy-supabase.yml` | `supabase/functions/**` push → Edge Function 재배포 |
