# Directive Audit — Future Work (2026-08-14)

Consolidated follow-up list from the directive-by-directive audit of `xau-speed-v1`.
Items marked "→ GH #" have a GitHub issue. Others are notes or link to an existing issue.

## Phase 1 — tomorrow (2026-08-15, urgent)

Ordered plan from the 2026-08-14 audit wrap-up, extended 2026-08-15 with the weekend findings:

1. **Scoring architecture: separate gates from scores** → GH #638 (urgent)
   - Additive unweighted composite lets gates/neutral conditions produce a misleading "42% BUY" noise floor. Split GATE (multiplier/pass-fail) from SCORE (directional, additive); no constant floors; weighted composite; fix the signal-strength denominator.
   - **Extended 2026-08-15** (comment on #638): the canonical missing gate is TRADABILITY. Centralise market-hours in the scoring engine (`protocol-gating.service.ts` should consult `MarketCalendarService.isOpen`); freeze closed-market signals "as of <last close UTC>"; fix `liquidity-check` scoring a closed market as "highly liquid 100/100" (zero volatility ≠ liquidity).
2. **Enforce readiness gate in code** → GH #627
   - Protocol must be inactive if any included directive is not `ready` (today only `alpha` is excluded; `beta` still scores).
3. **Fix MT5 timestamps** → GH #625
   - Prerequisite before trusting any time-based directive.
4. **Planning-ahead tools** → GH #640 (discussion)
   - Wider-timescale scoring (H4/D1/W1, session-agnostic directives) + weekend-aware views + new planning tools (gap projection, watchlist planner). Clearly labelled "planning — not live".

## Bugs (data / scoring correctness)

1. **MT5 bridge timestamps are not UTC** → GH #625 (bug, mt5-bridge, priority-high) — PHASE 1 (tomorrow)
   - Bridge returns naive wall-clock strings (`"2026-08-14T19:00:00"`, no timezone).
   - `new Date(naive)` parses as machine-local, so session detection is ~3–4h off.
   - Affects ALL time-based directives (`gold-session-profile`, `session-open-effect`, `monday-effect`, `friday-positioning`, …).

2. **`news-sentiment-positive` is a constant-output mock stub** → GH #626 (bug, area:scoring, priority-high)
   - Reads `bars[].sentiment`/`sentimentScore` — never written anywhere. Always returns mock 45/100.
   - Live in `xau-speed-v1` sentiment group. Same disease as deleted `vix-regime`.

3. **`earnings-proximity` is mock-first** → same issue #626
   - Returns neutral when no earnings calendar data; feed not wired.

## Process / policy

4. **Readiness gate** → GH #627 (enhancement, area:scoring, priority-medium) — PHASE 1 (tomorrow)
   - Policy: "if a directive is not ready, the protocol is not ready and should not be active."
   - Enforce in registry/scoring: active protocol cannot contain non-`ready` directives.

5. **Automated directive-honesty audit script** → GH #628 — BUILT 2026-08-14 as `nest/scripts/directive-guard.cjs`.
   - Static confession-lint + producer-trace + signalClass check + constant-floor check; plus a runtime constant-output test over `dist`.
   - First run: 0 errors, 112 warnings (mock-first stubs + legit date-driven calendar directives). Close #628 after triaging the warnings.

## Fine-tuning (no issue yet / low priority)

6. **DXY proxy is 3-bucket quantized (98/103/108)** — `gold-macro-correlation`'s "continuous" base is really 3 levels.
   - Widen the EURUSD→DXY proxy resolution in `EurUsdCacheService`/`protocol-gating.service.ts`.

7. **Stock-fundamental directives in gold protocols** — `dilution-impact`, `insider-activity`, `social-buzz`, `earnings-momentum` are DB-backed but return 0 for gold/forex. Related to existing GH #604 (symbol-aware relevance filtering). Verify none are in gold protocols; add relevance guard.

## News data (imported but unused)

9. **News-based signal gate** → GH #629 (enhancement, area:signals, phase-3)
   - Block/flag BUY when extreme negative news exists that may not be reflected in price.
   - News is a GATE, not a score — absence of news must not penalise a symbol's score.

10. **News-only stock protocol** → GH #630 (enhancement, area:strategies, phase-5)
    - Trade purely on news catalysts; queue signal for revision; wait for better entry.

11. **Symbol view should surface imported news** → GH #618 (commented 2026-08-14).

### Further news ideas

12. **News staleness / freshness gate (before severity)** — a "no fresh news in N hours" state means *unknown*, not *bad*. Check recency before reacting to severity (feeds can be sparse/rate-limited).

13. **News severity needs a producer** — today only `sentiment` (0–1) is imported; the agentic severity rating from #406 is not wired to `NewsArticle`. The gate (#629) is useless without a `severity` field. Noted on #629.

14. **News into backtest exclusion, not scoring** — annotate historical scores with "news hit here" so the gate can be measured retroactively. See closed GH #105 (`backtest-news-exclusion`).

15. **Earnings vs. news separation** — `earnings-proximity` is a *scheduled, known* event (calendar gate). Macro/headline news is *unscheduled* (the #629 gate). Different timing semantics — don't merge.

16. **Symbol-view news timeline** — show news overlaid on price history so "not yet reflected in market" is visually obvious. Folds into #618.

## Ongoing

8. **Continue directive-by-directive audit** — tracked under GH #608 (Audit All Directives).
   - `xau-speed-v1` fully reviewed 2026-08-14 — all 11 directives CLEAN/FIXED or DELETED (per-directive log in `/memories/repo/directive-audit-progress.md`).
   - ~85% of all directives remain un-audited. The guard (`nest/scripts/directive-guard.cjs`) now automates first-pass triage.
