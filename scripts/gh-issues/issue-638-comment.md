## Pre-Close Verification

Mapped the issue's 5 desired outcomes to the dual-score model (`docs/scoring-architecture.md`):

- [x] **1. Split GATE from SCORE** — gates (liquidity, budget, regime, market-open) now veto the **Signal** (timing) score instead of adding points; **Opportunity** (screening) keeps the additive view.
- [x] **2. Direction-neutral conditions must not add directional points** — `Signal = Σ directional-only` (directives whose `signalClass` is bullish/bearish). Neutral conditions (volatility, volume magnitude, squeeze/coiling) contribute 0 to Signal.
- [x] **3. No constant floors** — `HOLD_FLOOR` / `ENTRY_THRESHOLD` flat constants removed; thresholds are percentage-based; `directive-guard.cjs` flags constant-output / constant-floor directives.
- [x] **4. Weighted, not equal-additive** — *superseded*: instead of weighting, the model **separates** the concerns. Gates/neutral conditions no longer carry any weight in the directional decision (excluded from Signal entirely). Opportunity stays equal-additive by design because it is a screening rank, not a timing decision.
- [x] **5. Reconsider the signal-strength denominator** — Signal denominator is the sum of *directional* weights that fired (dynamic), not the inflated gate/neutral maxScore sum. Follow-up flagged in the resolution: a stable directional ceiling if the dynamic denominator's wobble confuses users.
- [x] **Build passes** — `npm --prefix nest run build` compiles clean.

The original "42% BUY noise floor" is gone: XAUUSD's genuinely-directional directives (~30 of ~450 raw points) now drive Signal independently of the always-on gate/neutral noise.
