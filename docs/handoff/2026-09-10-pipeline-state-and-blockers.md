# Pipeline State & Blockers — toward smooth trades

**Date:** 2026-09-10
**Status:** Four systemic defects fixed. Steady trading blocked by two POLICY questions.

---

## Fixed today (in order of discovery)

| # | Defect | Impact | Fix |
|---|---|---|---|
| 1 | Per-broker `tradingEnabled` memory-only, reset on boot | **Automated trades 94/mo → 9 → 1** | Persisted `automation.brokerTrading.<id>` + restore + boot log |
| 2 | 17 phantom `trade` rows (USDCAD), no broker counterpart | Open count inflated 21 vs broker's 4 | `reapStrandedTrades()` — now 4 = 4 exactly |
| 3 | Fabricated P&L from pre-close floating values | **82 of 112 closed trades had a shared exitPrice** | Bridge returns realised deal figures; Nest recomputes if absent |
| 4 | Paper trading booked `entryPrice` as a missing exit | Break-even trades invented; stats polluted | Refuses the close instead of fabricating one |

**Also:** `Queue void` vs `Queue skip` now separates "never signalled" from
"signalled but blocked (why)" — this is what made the current blockers visible.

## ⚠️ Correction to earlier claims

I twice concluded "FX sits ~15 points under the 65 gate". That was **wrong** — it
generalised from one moment's reading. The measured distribution over 2 hours:

| Symbol | min | avg | **max** | n |
|---|---|---|---|---|
| AUDUSD | 37.5 | 67.3 | **100** | 134 |
| NZDUSD | 0 | 52.3 | **100** | 126 |
| GBPUSD | 0 | 41.8 | **92.9** | 122 |
| EURUSD | 0 | 43.9 | **78.6** | 125 |
| XAUUSD | 40 | 68.9 | **90.4** | — |

**FX routinely exceeds 65.** The gate is reachable. Do not "lower the gate" on the
strength of a single sample — measure the distribution first.

## The real blockers now

Signals DO fire (AUDUSD hit 100). They are absorbed before execution by:

1. **Duplicate guard on occupied symbols.** Each open position refuses every new
   signal for that symbol. With only ~4 positions open, a large share of the
   liquid universe is suppressed at any moment.
   → **POLICY QUESTION:** is one-position-per-symbol correct, or should the guard
   allow a re-entry / scale-in? This is the single highest-leverage decision for
   trade frequency.
2. **High-severity directive conflict** on `xau-speed-4h` — real signal
   disagreement. Needs a directive-level look.
3. **`session-open-effect` double-counted in 6 protocols** — inflates composites,
   so it interacts with every calibration decision. Unresolved by design.
4. **Session gate** — WORKING CORRECTLY. NZDUSD at 100% is blocked because its
   bot is Asian-gated and Asian is closed. Not a fault.

## Verified working end-to-end

```
GBPUSD  EXECUTED  composite 71  Ticket 152610923382  2026-09-10 12:07:32
```
Score → queue → gates → broker → recorded trade. The chain is sound.

## Where to look next

- `strategy_signal_queue` — the live funnel (only ~2 rows at a time).
- `%TEMP%\nest-api.log` — `Queue skip` lines now name the blocking gate.
- `signals.gate.<protocolId>` in `global_setting` — per-protocol gate override
  (mechanism exists, currently unused). Prefer this over editing code defaults.
