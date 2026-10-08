🤖 Re-claimed by **primary** — 2026-10-07. Addendum to the 13:29Z comment (concurrent work, continued here rather than repeated).

## Addendum — timing, the LONG_ONLY half of "380", and the audit fix

### 1. #761 closed three minutes after that comment was written

The 13:29Z comment says *"#761 is the live one"*. **#761 closed ~13:32Z today** against live evidence: every band occupied (BUY 8,098 ticks / 26 protocols · HOLD 5,150 / 21 · STRONG_BUY 1,930 / 24), gate served, dispatch resumed 09-15, guard canaried. The wall that comment points at is settled — what is left below is genuinely this issue's.

### 2. Refinement — "380" counts BOTH directions; this protocol's numerator can only use **285 (31.3%)**

Of the four "reachable" directives in the 13:29Z table: `support-resistance-levels` emitted **bearish only** (239 ticks, avg 9.6) — and in a **LONG_ONLY** protocol a bearish reading contributes **zero** to the composite, by design.

| figure | meaning | value |
|---|---|---|
| *ever, any direction* | can the directive contribute anywhere | 380 / 910 = 41.8% |
| **direction-ALLOWED** | **can reach THIS protocol's numerator** | **285 / 910 = 31.3%** (rsi-oversold 140 + speed-momentum 120 + gold-round-numbers 25) |

Both are stable, outcome-derived figures — but only the second **bounds the ceiling**, and it is the one to compare against bars and #761's reachable figures.

### 3. The ceiling is market-conditional — measured on 1h today, and gold QUEUED

`xau-speed-1h` rawComposite: **8** (12:12Z) → **80** (12:28Z) → **138** (afternoon). Cause, from the stored breakouts: `rsi-oversold` turned **bullish** (RSI 28.5, score 90/140, counted) while `speed-momentum` read **bearish** (−0.81% velocity, excluded). And the pipeline acted: `strategy_signal_queue` today has **3 XAUUSD entries** (`xau-speed-m15`, `xau-speed-1h-copy`, `xau-speed-m15-copy`, pending).

So the 10-01 "3 bots CAN NEVER trade" is now **1** — Gold Position 4H (bar 8 vs achieved 6.8%). 1h (bar 9 ≤ 11.9%) and m15 (bar 10 ≤ 15.2%) clear.

### 4. Audit message fixed (declared code change)

`nest/scripts/audit-data-health.cjs` — the failure text said *"These can NEVER trade… most likely a denominator/scale change… see style-thresholds.ts"*. That now sends triagers to re-open a **verified** decision. Replaced with: the measured window, the market-conditional cause, **this issue**, and an explicit "not the 09-10→15 condition — do not 'fix' style-thresholds.ts". The check still **fails (exit 1)** while a below-bar bot exists; the docblock carries the full correction.

### 5. Capacity policy — recommendation recorded (no maths executed)

- **Cap at ~500: not supported.** It moves the fault — an identical reading scores *higher* on a protocol with more dead capacity. Recommend: no cap.
- **Denominator stays CONFIGURED** (settled: #761 + register row 10; config-side exclusions reverted + guarded, row 9).
- **Outcome-derived capacity** (window + cold-start) remains its own decision; any execution is a maths change with a copied configuration — measurement path is the **backtest** (#965 / §7.4).
- **The four neutral-only directives** are a per-directive question (`gold-session-profile` averages 69.2/90 for zero contribution) for the #688-class protocol review — not a denominator one.
- **Gold Position 4H** (bar 8 vs 4h achieved 6.8%) — a bar-vs-ceiling calibration question for the strategy-by-strategy review.

Nothing in scoring, maths or config was changed. This comment + the code fix are the landing.
