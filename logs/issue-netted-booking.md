One closed XAUUSD position is booked as **−£613.07 across 10 trade rows**, and the totals depend on the row rather than the position.

**Measured 2026-10-07 from `trade`:**

- The 2026-09-30 A/B pile (`brokerComment LIKE 'TCS AB-%'`, closed 14:37:00 together): **10 rows, total −613.07 = 9 rows × −32.267 + 1 row × −322.67.**
- The true net of the position is not derivable from the rows; each row carries its own figure and they do not reconcile to one net.
- The single biggest "loss" in the gold family ledger (−£322.67, attributed via `scoringStrategyId` to "Gold Position 4H (copy)") is **one row's share of this netted close**, not a single trade.

**Why this matters now:** any statistic that reads rows — the app-wide ledger (268 closed, 124W/144L, net −£786.27), per-bot P&L, the Strategy Comparison page, bot rating (#894), A/B verdicts — **double-counts this position**. #1014 predicted exactly this ("all four orders share ONE positionId … the reconciler books the position's ENTIRE net to each, with no volume split — a 4x overstatement waiting for the next A/B run"); the next runs happened and the overstatement is live. #931's `pnlInvalid` filter does not catch it (these rows are flagged valid).

**Context:** the incident position is the 2026-09-30 netting case from R31 (#1044 split machinery, `pnl-split.spec`). The split intent landed — this pile shows its output still sums to more than the position.

**Acceptance:** one netted position yields row P&Ls that SUM to the position's realised net (any split is explicit and volume-weighted), plus a canary on a multi-row netting fixture — and a re-stated ledger once fixed.
