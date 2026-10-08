## Correction (2026-10-08) — the actor **IS** named for the 93; the real remainder is a LOOKUP defect (#1089)

The comment above concluded: *"The actor closing the winners is therefore NOT NAMED, and cannot be from this data."*
**That conclusion is withdrawn.** It was drawn from the `trade` table alone — the reader — before the write path was read. `close-reason.ts` records the answer, measured **2026-10-07**:

1. **`broker:terminal` — identified.** All 93 rows predate **2026-10-02**; they are the owner's own manual bulk closes (R46: *"Yes I think that was me bulk closing the positions"*), and the batches **stopped 2026-10-02** (0 in the five days after; 2–13/day before). The deal-reason mapping now reports an unstamped CLIENT/MOBILE/WEB/EXPERT close as `user:manual`; `broker:terminal` remains only for broker-driven reasons (rollover/margins/split) and the 93 historic rows.
2. **`broker:unknown` — not missing evidence; unasked-for evidence.** → **#1089**. `getDeals()` asks only the primary bridge (`:5000`), so **every** broker-3-routed symbol reads blind: VIX/GER40/FRA40/US30/UK100/XAGUSD are **48 of 48 `broker:unknown`** all-time, with zero attributed closes ever. Four of yesterday's rows were traced to their real closing deals on `:5001` — all **`reason 4` (SL fills)** — with realised profit that differs from what was stored (GER40: real −8.18 vs stored −7.19; the row kept the last snapshot price).

### The capture, by who actually closed the winners

| closeReason | winners | avg win | avg move | reading |
|---|---|---|---|---|
| `broker:terminal` | 66 | +5.28 | **2.04** | the owner's bulk closes (historic) |
| `system:time-stop` | 29 | +1.47 | **0.58** | the bot's clock exit books crumbs |
| `broker:unknown` | 14 | +6.96 | **26.06** | ≈84% of target — and the closing actor is exactly what #1089 makes readable |
| null 9 · sl 6 · tp 1 | 16 | +8.52 | — | recovery rows, trailing stops, the single TP |

⚠️ **So "winners exit at 16.9% of target" is composed mostly of manual closes and the time-stop's crumb-booking** — and the only bucket that reached target is the one whose closer cannot be read. **The figures in the first comment stand; the conclusion drawn from them does not.**

### Corrected accounting of "143 of 275 (52%) have no captured reason"

| | n | now known to be |
|---|---|---|
| `broker:terminal` | **93** | the owner's manual bulk closes + broker-driven events — **named** |
| `broker:unknown` | **50** | **34** broker-3 deal blindness (**#1089**) · **16** XAUUSD A/B rows (#1079/#1080 threads) |

Nothing is left unexplained except through **#1089**, which now has the code fix, three guarding tests and a canary (2 failed when mutated back to the single-URL call, 8 passed restored). The repair of the 48 stored rows is the open part, noted in the issue.
