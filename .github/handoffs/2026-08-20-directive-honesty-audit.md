---
date: 2026-08-20
area: scoring
type: feature
---

## What Changed

Automated directive-honesty audit (#628) — completed the mechanical guard so
"completeness theater" is caught by tooling, not manual review.

- `nest/scripts/directive-guard.cjs` — added MODE 7 readiness evidence
  (`--db`): every `ready` directive must have recorded scores in the DB
  (`Score.breakdown.breakouts`) that vary. Thresholds: ≥10 records and ≥2
  distinct values, else WARN. DB access is optional/local — skipped cleanly
  when DATABASE_URL is unset, Prisma isn't generated, or the DB is down.
- CI: `.github/workflows/ci.yml` backend job now runs
  `node scripts/directive-guard.cjs --static-only` after build (fails on
  ERROR findings — confession strings / duplicate ids).
- `nest/package.json` — `audit:directives` script for manual runs.

## Capability Map Entry

- **name:** Directive honesty guard
- **persistence:** none (read-only audit)
- **uiSurfaces:** 0

## QA

- Static-only run (CI path): 0 errors, 50 warnings, exit 0.
- Full run: 0 errors, 81 warnings (constant-output suspicions etc.).
- `--db` run against live MySQL: "35 directives scored in DB, 111/130 ready
  directives lack evidence" — flagged every ready directive with zero/weak
  evidence, including constant-value production data (`dilution-impact`: 46
  records / 1 distinct; `earnings-momentum`: 54 records / 1 distinct).
- `news-sentiment-positive` was already deleted by the 2026-08-14 audit;
  the guard now flags its successors (placeholder-directives.stub family).

## Architecture Entries

- Script: nest/scripts/directive-guard.cjs — owner: directive honesty audit (#628).
- CI: backend job includes the guard (static-only).
