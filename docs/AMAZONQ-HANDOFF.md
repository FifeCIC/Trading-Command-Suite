# AmazonQ Handoff Plan

This file defines what AmazonQ should do next, in order, with minimal ambiguity.

## Current State Snapshot

G:\My Drive\Project Management\Live\TradePress-Documentation\exit-wordpress

- Frontend app: Trading Command Suite at http://localhost:5188
- Backend app: Nest API now inside repo at `nest/`
- API base in frontend: `http://localhost:3201`
- Backend endpoints currently stable for UI cards:
  - `GET /api/version`
  - `GET /api/providers/health`
  - `GET /api/imports/runs?limit=5`
- Redis is intentionally not required for local startup right now.
- PostgreSQL is still optional for basic UI flow, but required for persistent real data.

## What AmazonQ Should Start With

1. Backend README rewrite (high impact, low risk)
- Replace generic Nest starter README with project-specific setup.
- Include:
  - exact run commands
  - local fallback behavior (no DB / no Redis)
  - endpoint contract used by Architecture page
  - where to change ports safely
- Acceptance:
  - New dev can boot frontend and backend from README alone.

2. Opt-in infra bootstrap script (PostgreSQL + Redis)
- Implement `scripts/setup-local-infra.ps1` so services are installed and started only when explicitly requested by flags.
- Script must support dry-run mode by default.
- Acceptance:
  - `-DryRun` prints planned actions only.
  - `-InstallPostgres` and `-InstallRedis` run independently.
  - Script logs actions and final status clearly.

3. API local mode contract hardening
- Add a visible `mode` field (`fallback` or `full`) in API responses used by Architecture page.
- Keep status 200 for fallback responses.
- Acceptance:
  - Architecture page can display "Fallback mode" badge without errors.

4. Frontend Architecture page enhancements for fallback clarity
- Show explicit notice when API is in fallback mode.
- Distinguish:
  - missing credentials
  - database unavailable
  - queue disabled
- Acceptance:
  - User can tell what to do next without opening server logs.

5. Controlled queue re-enable plan (behind feature flag)
- Add env flag for queue mode, example: `QUEUE_MODE=off|local`.
- Keep default `off` so Redis is not assumed.
- Acceptance:
  - `off`: no Redis noise, no queue worker initialization.
  - `local`: queue components initialize if Redis is available.

## Suggested Prompt For AmazonQ (Copy/Paste)

You are working in `c:/wamp64/www/trading-command-suite`.
Follow `docs/AMAZONQ-HANDOFF.md` exactly.
Start with item 1, then item 2.
Do not install PostgreSQL or Redis unless I explicitly approve and provide flags.
Keep local mode stable without DB/Redis.
After each item, report changed files and acceptance checks.

## Guardrails

- Do not move folders outside the main repo.
- Keep backend under `nest/`.
- Keep local task map in `c:/wamp64/www/intranet/api-tasks.php` aligned if paths or commands change.
- Do not assume paid cloud services.

## Fast Validation Checklist

- Frontend build succeeds: `npm run build`
- Backend build succeeds: `npm --prefix nest run build`
- Backend starts on 3201: `npm --prefix nest run start:dev`
- Endpoint check:
  - `/api/version`
  - `/api/providers/health`
  - `/api/imports/runs?limit=5`
