## The finding

Five directives exist specifically to signal that an **open** position should be left. All five have **never executed a single time**:

`momentum-exhaustion` · `target-achieved` · `regime-shift-exit` · `time-stop` · `chandelier-exit`

Measured 2026-09-28 over 6,693 score breakdowns in 3 days:

| directive | appearances |
|---|---|
| `liquidity-check` | 6,687 |
| `multi-timeframe-trend` | 1,222 |
| `btc-halving-cycle` | 426 |
| **`momentum-exhaustion`** | **0** |
| **`regime-shift-exit`** | **0** |

**Cause: they are hosted by `mt5-technical-core-v1`, and that protocol is `active = 0`.** `mt5-technical-short` is also `active = 0`, and `protocol_score_status` holds **no row** for it — it has never ticked.

## Why this matters — it is the missing short side

Owner, 2026-09-28:

> *"I'm also wondering if what I'm seeing is showing that a protocol is entering at a good time, and we're potentially seeing an opportunity to SHORT, through the bleeding, and we're not scoring a short at that point."*

There are two independent gaps here, and they compound:

| Gap | State |
|---|---|
| **Detection** | the 5 exit directives that would flag "leave now" never run |
| **Direction** | `mt5-technical-short` is disabled, so no short-side scoring exists at all |

So at the exact moment a position peaks and starts bleeding, **nothing in the running system is scoring that move in either direction.**

## The evidence that a bleed is real and systematic

21 closed XAUUSD trades (A/B excluded), peak reconstructed from 5m bars between `openedAt` and `closedAt`:

| Metric | Value |
|---|---|
| Avg peak unrealised | **+0.424%** |
| Avg final | **−0.116%** |
| Reached profit | **20 / 21 — 95%** |
| Peaked, then ended flat or loss | **12 / 21 — 57%** |

`momentum-exhaustion` and `regime-shift-exit` are the two directives built to detect precisely this turn. They have never had the chance.

## ⚠️ What must NOT be assumed

**Do not treat this as "enable the protocol and it will work."** `active = 0` is not the only thing that can stop a directive scoring — **#999** measured 8 of 11 gold directives permanently neutral with 90% of the m15 denominator unreachable, and **#995** found the existing exhaustion directives are bullish *entry* signals, detecting exhaustion only on the way down, never on the way up.

So the work is: establish **whether these five would produce anything** before deciding what their activation means.

⚠️ **And do not read the `+0.424%` peak as a short opportunity yet.** That figure is measured *at the peak*, which is only identifiable after the fact. A short strategy must detect the turn in real time — measuring it from the known peak is look-ahead bias and would not survive implementation.

## First action — measurement, not a fix

1. Run the 5 directives in **isolation** against real bars for a symbol with a known bleed and record what each returns (`signalClass`, `score`, `reason`). A working path to do this now exists: `ExitConsensusService` invokes them individually and is exposed at `GET /api/scoring/exit-consensus`.
2. For each, confirm it can return **non-neutral** on any recent bar. A directive that is structurally always-neutral is a different finding from one that is merely switched off.
3. Only then decide whether activating `mt5-technical-core-v1` is the right move — or whether these directives belong somewhere that actually runs.

## Acceptance criteria

1. A recorded result showing what each of the 5 exit directives returns when invoked directly, with the bar cadence used.
2. A statement of whether each **can** produce a non-neutral verdict, or evidence that it cannot.
3. A decision (not necessarily an implementation) on where these directives should live, posted as a comment here.

## Related — each carries a clue

- **#998** (durable peak tracking; the give-back is real and measured)
- **#995** (the guardian detects exhaustion going DOWN but never going UP; both exhaustion directives are bullish entry signals)
- **#999** (8 of 11 gold directives permanently neutral — the m15 denominator is 90% unreachable)
- **#1013** (a directive starved to 0 on 99.6% of ticks by a cadence fall-through — the same "it runs but produces nothing" shape)
- **#916** (winners exit at a third of their target while losers reach the stop)
