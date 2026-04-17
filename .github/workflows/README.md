# GitHub Actions

## Our workflows

Added for the web-integration layer on top of `icip-cas/PPTAgent`:

| File | What it does |
|------|-------------|
| `ci-web-api.yml` | Ruff + Mypy + import smoke test on `api/`, Next.js `tsc` + `build`, Deno `fmt`/`check` on `supabase/functions/llm-proxy` |
| `deploy-web.yml` | PR → Vercel preview, push → Vercel prod. Posts preview URL back to the PR |
| `deploy-api.yml` | Builds `api/Dockerfile` → GHCR (`ghcr.io/<owner>/pptagent-api`), then `flyctl deploy --image ghcr.io/<owner>/pptagent-api:latest` |
| `deploy-supabase.yml` | `supabase functions deploy llm-proxy` with a `--dry-run` lint step before the real deploy |

## Upstream workflows left untouched

The original repo ships with `contributors.yml`, `docker-publish.yml`, and `pypi-publish.yml`.
They are still in this repo and still fire on their original triggers. If you don't want
them to run on your fork, disable them in **Actions → All workflows → Disable**.

## Where to start

1. Follow `.github/SECRETS.md` to register tokens.
2. Push to `main` → watch the `Actions` tab.
3. The first `deploy-api.yml` run can take ~8 minutes because it installs Playwright + the pptagent wheel inside the image; subsequent runs are cached (≈2 min).
