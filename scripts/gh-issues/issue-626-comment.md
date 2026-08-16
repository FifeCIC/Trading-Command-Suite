## Pre-Close Verification

- [x] **`news-sentiment-positive` removed** — `news-sentiment.directive.ts` deleted (handoff `2026-08-14-delete-news-sentiment-positive.md`).
- [x] **`earnings-proximity` demoted and excluded from scoring** — `readiness` changed `beta → alpha`; the readiness gate (#627) now pauses any protocol containing it, so it no longer contributes a constant mock score.
- [x] **No directive returns a constant mock score inside any active protocol** — both former mock stubs are either deleted or gated out of scoring.
- [x] **Build passes** — `npm --prefix nest run build` compiles clean.

> Note: `earnings-proximity` is **demoted, not deleted** — it remains registered as `alpha` because strategy seeds and the alert trigger still reference it. It is inert for scoring. Full deletion is a separate follow-up if desired.
