## Measured on the sprint's own complaint — the blocks are RISK LIMITS, not signals or scores

The sprint opens with *"the app seems to open at the worst times and most positions go into the red then
close"*. Measured today (`decision_log`, 2026-10-07, UTC day):

| block reason | blocks | symbols | config |
|---|---|---|---|
| `Daily loss $178.02 exceeds risk.maxDailyLoss ($100)` | **440** | 13 | `maxDailyLoss` |
| `Portfolio at risk 17.7–18.3% exceeds risk.maxPortfolioRisk 15%` | **~282** | ~10 | `maxPortfolioRisk` |
| `Duplicate blocked for XAUUSD: 1 open position(s) on MT5` | 53 | 1 | duplicate guard |

**Executions today: 7** — XAUUSD ×5, GER40 ×1, VIX ×1.

### What this changes about the sprint's diagnosis

⚠️ **Block #2 of this sprint ("scores that cannot produce actionable output") is not what is stopping trades
today.** Two risk *caps* are, and between them they account for **~722 of ~800 blocks**:

- **`maxDailyLoss` fires 440 times across 13 symbols.** Once the day is down $178 against a $100 cap, **every
  further entry is refused for the rest of the day** — that is a one-way latch, not a per-signal check.
- **`maxPortfolioRisk` fires ~282 times.** The book sits at ~18% against a 15% cap, so **no new position can
  open until existing ones close or shrink.** Also a latch while the condition holds.

**Neither is a fault in the scoring pipeline.** Both are the gates doing what they are configured to do. But the
consequence is what the owner described: the app cannot open anything, and the only way out is for the existing
book to come back.

### ⚠️ Why this is NOT being changed here

**A risk cap is a number that gates a trading decision — it is "the maths", and
`maths-change-requires-ab` requires a COPIED configuration and a monitored comparison, not an edit.** Raising
`maxDailyLoss` or `maxPortfolioRisk` in place would change what every bot may do, with no comparison and no way
to attribute the outcome. Recorded instead, so the decision is visible and can be taken deliberately.

⚠️ **It also bounds what any single protocol can achieve.** Context for the VIX work in progress: VIX scored,
signalled and **executed today** — its remaining 11 blocks are this same portfolio gate, not a VIX fault. **A
perfect VIX protocol cannot open a position while the portfolio is over its cap and the day is over its loss
cap**, so tuning a VIX strategy without deciding these two numbers would be measuring the caps, not the strategy.

### Not done

⚠️ Not filed as a new issue — the owner is holding the backlog down, and this is a measurement of the sprint's
own complaint rather than a new defect. If it warrants a decision it belongs with the trader-controls work
(**#943**), not as fresh backlog.
