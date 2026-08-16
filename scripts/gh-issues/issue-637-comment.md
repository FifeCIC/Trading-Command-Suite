## Pre-Close Verification

Mapped to the issue's two outputs:

- [x] **Documented matrix (Google Drive long-term reference)** — written to `docs/theories/timeframe-directive-importance-matrix.md` on Google Drive. Rows = the 12 shared GOLD directives; columns = Tick / Scalp / Day / Swing / Position; cells = rank (H/M/L/drop) + per-band maxScore + RSI threshold delta + risk-gate multiplier band.
- [x] **Concrete per-protocol directive tweaks for #609** — a per-protocol payload (`directiveMaxScores`, `drop` list, RSI `thresholds`, `riskGate` multipliers) for all five protocols. Resulting max totals are distinct by design: 790 / 910 / 855 / 685 / 485, with micro-structure-heavy Tick vs macro-heavy Position shape.

## Data grounding

- Directive inventory pulled from the 12 live directive classes (maxScore, readiness, directionBias).
- Protocol/band mapping read from `protocols-seed-data.ts` (the five `xau-speed-*` protocols, `derivedFrom: xau-speed-v1`).
- No code changed — this is design only; runtime wiring is #609.
