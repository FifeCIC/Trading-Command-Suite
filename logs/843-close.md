## Pre-close checklist — #843 (position sizing: one implementation, and the live path gets it)

**The theme, applied:** there is now **ONE sizing implementation**. The backtester and the live automation loop call the same maths (`nest/src/modules/trading/position-sizing.ts`); a second copy cannot drift from it because there is no second copy.

### What changed

| Piece | Change |
|---|---|
| `position-sizing.ts` (NEW) | `computeSizing()` — the four models, extracted from the backtester; `applyVolumeConstraints()` — broker step rounding + min/max clamping; `valuePerPriceUnitPerLot()` — tickValue/tickSize → money per 1.0 price move per lot |
| `backtest.service.ts` | The inline model block (L~703) now calls `computeSizing()`; ATR measurement, share-unit flooring and the Kelly no-edge `size 1` policy stay at the call site, deliberately (documented in the file) |
| `automation-loop.service.ts` | NEW `resolveDispatchVolume()`, called in the queue tick **before** `assessGlobalRiskLimits` and in the A/B arm dispatch. `fixedLot`/NULL returns `baseSize` **unchanged**. Sized models refuse visibly (`TCS-TRADE-023`) on any missing input; the calculation (`equity × risk% ÷ stop = units ÷ money-per-lot = lots`) rides on the EXECUTED/QUEUED decision |
| `mt5.adapter.ts` / bridge | `/symbols` now ships `volumeStep`, `tickValue`, `tickSize`, `contractSize` (additive); `getSizingContext(symbol)` resolves equity + constraints through the **same route `placeOrder` uses** |
| DB | `trading_strategy.sizingModel` + `sizingRiskPct` added via `ALTER TABLE` (schema.prisma updated in the same change, `schema-init.sql` regenerated); both declared in `bot-rules.ts` (`enforcement: live`) |
| Notices | `TCS-TRADE-023` “Position size could not be computed” registered in both catalogues (54 codes) |

### Acceptance — evidence per item

- [x] **One sizing implementation; backtester and loop call it** — single module, imported by both; no second copy exists (`grep computeSizing` = one definition).
- [x] **Equal-risk across volatility extremes — demonstrated with the maths, not asserted** — the spec computes the actual MONEY RISK of the two resulting orders: gold (stop 24.0) and EURUSD (stop 0.011) both land within 15% of the configured 1% of $10,000, and the spec ALSO asserts the old fixed-lot path risks $24 / $11 — unequal and neither 1%. That contrast case is what stops the test passing for the broken behaviour.
- [x] **Rounded to `volumeStep`, clamped min/max, unclampable fails visibly** — `applyVolumeConstraints` floors to the step (float-noise tolerant: 0.3 ÷ 0.1 → 0.3, canaried), raises to min, caps at max (both reported as `action`), and REFUSES with `TCS-TRADE-023` for unknown step/min or impossible constraints (max < min).
- [x] **Backtest-live parity for the same inputs** — same function, same formula path for `fixedPercent`/`atrEqualRisk`/Kelly; the backtester's fallback denominators (`currentClose` on no-stop) are preserved exactly and pinned in the spec.
- [x] **Existing fixed-lot bots unchanged** — `sizingModel` NULL ⇒ `fixedLot` ⇒ `baseSize` sent unchanged, **no rounding, no clamping** (deliberately — the bridge validates what it always did). No bot was migrated.
- [x] **Testing proves the model** — `position-sizing.spec.ts`, **18 tests**, boundaries both directions (step floor + the 0.3/0.1 float edge, min raise, max cap, max=0 ⇒ no ceiling, unknown-input refusals, Kelly no-edge vs positive-edge, tick conversion). **Canary: 3 mutations, 3 firings** (equal-risk divided by price → 1 fail; float tolerance removed → 1 fail; unknown step guessed → 1 fail), restore hash-verified. Log: `logs/canary-843.ps1`.
- [x] **Sizing before the risk gate** — `resolveDispatchVolume()` runs at the `baseSize` read, upstream of `dispatchTrade()`'s `assessGlobalRiskLimits()`, which therefore sees the real exposure.
- [x] **Gates run** — typecheck ✅ · jest 18/18 + full suite in build ✅ · notices ✅ · bot-rules (43 columns, 38 declared) ✅ · db:check ✅ · **build succeeded, API restarted, 0.125.0 healthy** ✅ · bridge serves `volumeStep` live ✅ (`GET :5000/symbols`).

## Deferred — work handed on

- **Demo-account ORDER demonstration of equal-risk sizing** — not done here because **the market is closed (Friday night)**; the sizing path executes only when a bot dispatches, and no dispatch can fill while the venue is shut. The maths is proven by spec + canary, the data path is proven live (bridge fields + route-sharing adapter), and the wiring compiles and is exercised on the next open session. Owner: **#843** (reopen with the fill evidence, or read the first sized EXECUTED decision of the day — every sized order carries its full calculation string).

## Deliberately unchanged

- **Kelly's live cap stays 25%** (a named constant at the call site, matching the backtester's default) — a bot-level cap column does not exist; adding one without a consumer would repeat the “selectable but ignored” defect #843 is about.
- **Kelly's live no-edge policy is REFUSAL, the backtester's is `size 1`** — each caller owns the policy; both are documented at their call sites and in the module header. This divergence is deliberate, not drift.
- **`useRaritySizing` / `maxSize` remain legacy-only** — declared as such in `bot-rules.ts`; not resurfaced here.
