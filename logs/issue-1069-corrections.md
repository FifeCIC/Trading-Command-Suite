## Two corrections to this issue's own framing — both measured 2026-10-05

Both change what the fork costs. Neither changes the finding.

### 1. "And they reach the code" — the sign divergence CANNOT fire

My 2026-10-04 comment concluded the 19 NULL-side rows reach the divergent readers, and that *"the P&L alert and `exit-consensus` would report the opposite direction for the same holding."* **That is wrong.** Both readers are MT5-only:

| reader | position source | what it can see |
|---|---|---|
| `exit-consensus.service.ts` `assessAllWithStatus()` | `this.mt5.getPositions()` → `Mt5Adapter`, every active **MT5 bridge** (#883) | MT5 positions only |
| `stop-guardian.service.ts:1087` | `this.mt5Connection.getAllPositions() as Mt5RawPosition[]` | MT5 positions only |

The 19 NULL rows came from a **Trading 212** sync. MT5 rows carry `buy`/`sell` (6 + 1, unchanged since the original measurement). So **no row reaches both the canonical's LONG default and those two readers' SHORT default.**

**The sign divergence is reachable in code and unreachable in data — which is what the ORIGINAL measurement said.** My correction drew the wrong conclusion from a right count: 19 of 26 rows *do* have an unrecognised side, and *they are not the rows those two readers see.*

### 2. "Divergence 3 — no guard at all in `stop-guardian`" — this is false

Both sites guard the division, and the guard sits immediately above the assignment:

```
1535:  if (!Number.isFinite(pos.priceOpen) || pos.priceOpen <= 0) return;
1538:  const isBuy = pos.type === 'buy';
1541:  const profitPct = …

1619:  if (!Number.isFinite(pos.priceOpen) || pos.priceOpen <= 0) return;
1632:  const isBuy = pos.type === 'buy';
1659:  const profitPct = …
```

Both also bail on a non-finite `priceCurrent`. **The only difference is the SIGN TEST, not the guards.** The issue's third divergence does not exist and should not be counted when costing the fix.

### What still stands

- **Four implementations, divergent edges, one canonical owner.** The finding is unchanged.
- **Divergence 1 (sign)** — real in code; cannot fire on today's data.
- **Divergence 2 (`0` where the canonical returns `null`)** — `exit-consensus.service.ts:373` returns `0` for `entry <= 0`, and **this one IS reachable**: an MT5 row arriving with a zero cost basis gets a definite break-even claim instead of "cannot judge" (register row 60). No such row exists today.

### What this does to the fork

| option | cost, restated on the measured facts |
|---|---|
| **A** — canonical stays long-defaulting, the others match | consistency for a case the two readers **cannot currently encounter**. Cheap; removes a trap a future position source would spring |
| **B** — canonical returns `null` for an unknown side | same reachability, **plus** it changes what a bad-data row reports today (`0` → `null`) — the one part that is reachable |
| **C** — establish the side at the T212 import | **the only option with live effect**: 19 rows genuinely have no established side and the display is guessing LONG for them |

**C remains the recommendation, and for a stronger reason than before:** it is not competing with A and B over the same 19 rows — those readers cannot see them at all. C is the only option that touches data that actually exists, and A/B are hygiene against a case that would need a new position source to reach.

⚠️ **The general lesson, recorded because this is the second time this issue has been costed on a stale premise:** a correction is a claim too. The count was re-measured; the *conclusion* drawn from it was not. Reachability needs both halves measured — **which rows have the value**, and **which readers can see those rows**.
