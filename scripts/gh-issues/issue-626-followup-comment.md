## Follow-up (2026-08-16): "remove from all protocols" now complete

The pre-close verification above demoted `earnings-proximity` to `alpha` (so `directive-inclusion.ts` rule 1 excludes it from scoring), but the *"remove from all protocols"* half of the proposed action was still outstanding — the directive remained listed in protocol and strategy definitions.

Completed now:

- **`directive-groups.ts`** — removed from LONG `sentiment` and SHORT `bearish-sentiment` groups (with NOTE comments).
- **`protocols-seed-data.ts`** — removed from `qqq-day-v1`, `tsla-speed-v1`, `momentum-stock-v1`, `earnings-momentum-v1`, `mt5-technical-short`.
- **Strategy seeds** — removed from `built-in-strategies.seed.json` (`ai-titans`), `strategy-prerequisites.ts` (`earnings-catalyst`), and `strategy-seeds.ts` (`Earnings Momentum Play`, `Tech Titans`).
- Added a design-decision doc comment on `earnings-proximity.directive.ts` explaining why it stays `alpha` and is rehomed as a catalyst directive in #648.

The class remains registered (visible to registry/audit) but now appears in no scoring protocol or strategy. Build passes. Handoff: `2026-08-16-remove-earnings-proximity-from-scoring.md`.
