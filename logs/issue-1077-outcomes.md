## Refreshed evidence 2026-10-09 — and a correction to what the shadow numbers MEAN

The 10-07 note (27 lines, 11 incumbent-opposing, 7 would-cross) was the morning's sample. Full window now: **10-07 → 10-08 complete logs — 918 `DECLINED` lines, 876 carrying the shadow field, 31 unique tickets.**

### ⚠️ Correction first: "would cross the gate" is NOT "would move a stop"

Re-reading the guardian's own code: for a BUY, `recommendedSl = max(price − trail, currentSl)` — **a tighten only happens when the trail target sits ABOVE the current stop** (`rec > sl` materially; the adjust condition is `|rec − sl| > 0.00001`). A gate-open whose `rec == sl` resolves to `at-target` — **no action**.

The log carries both numbers (`sl=` and `rec=`), so this is measurable directly:

| Measure | Lines | Unique tickets |
|---|---|---|
| parsed with shadow | 876 | 31 |
| gate-cross (aligned ≥ 1 ∧ opposing = 0 after swapping in the shadow) | **475** | 24 |
| …of which `rec == sl` → **would still be `at-target`, no action** | **466** | — |
| …of which `rec` moves materially in the tighten direction (**+ its materiality**) | **9** | **7** |

### The 9 real tighten events — and whether the tightened stop would ever have been hit

Counterfactual test: after the event instant, did price ever reach the candidate level? (5m `marketbar` lows/highs; touch-approximation, no fill modelling.)

| ticket | symbol | event (UTC) | stop would move | subsequent extreme | reached? | actual outcome |
|---|---|---|---|---|---|---|
| 93923651 | US30 | 10-08 20:10 | 51111.1 → **51133.55** (+22.4) | min low **51240** | **NO** | still open, +$8.40 |
| 152739238602 | XAUUSD | 10-08 08:18 | 4003.77 → 4005.34 (+1.57) | min low **4105.15** | **NO** | closed +$1.57 |
| 152742842575 | EURJPY | 10-08 20:05 | +2.2 pips | min low **176.805** (stop ~175.3) | **NO** | closed +$0.40 |
| 152742689999 | AUDJPY | 10-08 20:05 | +1.4 pips | min low **109.774** | **NO** | closed +$0.33 |
| 152742751346 | NZDJPY | 10-08 20:05 | +0.2 pips | min low **88.26** | **NO** | closed +$1.55 |
| 93800243 | VIX (SELL) | 10-08 13:18 | 17.3000 → 17.2998 (nil) | max high **17.04** | **NO** | closed −$0.02 |
| 152739043384 | USDCHF | 10-08 09:10 | +0.00002 (nil) | min low **0.83066** | **NO** | closed −$1.49 |

**None of the 7 candidate stops was ever reached in the tracked window (event → close, or → now for US30).** Two of the seven would produce a genuinely material tighten (US30 +22.4 points ≈ 2.4× the 5m ATR; XAUUSD +1.57); the rest are sub-pip to 2.2 pips, against stops sitting ~96–125 pips from market.

### What this establishes (and what it does not)

✅ **Establishes:** the gate is **not the binding constraint**. Even with a corrected indicator, **466 of 475** gate-crosses would remain `at-target` no-ops — the trail target sits at or inside the existing stop on those ticks. The guardian's inactivity is substantially a **distance/at-target condition**, not only a wrong input. And on the 9 exceptions, the market never returned to the candidate level inside the window.

⚠️ **Does NOT establish:**
- **Any P&L effect.** Zero positions would have been touched — the counterfactual P&L delta in this window is **0 on all 7**; that is a window observation, not a verdict on B/C.
- **That the incumbent is fine.** Agreement evidence still stands: 831/876 lines incumbent-opposing; the shadow discriminates both ways (110 lines where the incumbent aligned, the shadow opposes).
- US30 is still open — its row is "not yet", not "never". (The candidate stop remains ~85 pts below the current 51,274.)

### Consequence for the B/C/D decision

The decision now has: agreement (measured), stop-level impact (measured — 9 events, 2 material), and outcome-to-date (measured — none reached). What it does **not** yet have is a **reason for the incumbent to act at all** in this window — which is itself evidence for the "leave it" side of the ledger. No threshold, protocol, directive or stop logic was changed; the shadow remains the instrumentation. **Decision B/C/D remains the owner's** (exit-path maths).

🤖 primary — 2026-10-09. Working material: `logs\issue-1077-outcomes.md`; parse is reproducible from `nest/logs/tcs-2026-10-0{7,8}.log`.
