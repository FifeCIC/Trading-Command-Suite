# Handoff — #761 directional-capacity defect + three scoring designs + control protocol

**Date:** 2026-09-11
**Issues:** #761 (primary), #758, #763, #773
**Type:** measurement + design documentation + new protocol

---

## What changed

### 1. Measured the #761 defect properly (first defensible figure)

24h across all active protocols:

| `signalClass` | instances | avg score | total magnitude |
|---|---|---|---|
| **neutral** | **17,420** | **35.0** | **610,517** |
| bullish | 3,402 | 49.5 | 168,278 |
| bearish | 2,915 | 18.4 | 53,686 |

**78.6% of all measured magnitude is neutral, averaging 35.0 — a substantial
reading, not an absence.**

### 2. Identified the mechanism precisely

The numerator accepts only `bullish`/`bearish`. The denominator counts every
non-gate directive's `maxScore`. **A directive that can never emit a direction
therefore adds full weight to the scale while being structurally incapable of
adding anything to the reading.**

Proof by decomposition — one real BUY reading, where `rawComposite = 140` is
exactly `80 + 60`:

| directive | score | maxScore | in numerator? |
|---|---|---|---|
| `rsi-oversold` | 80 | 140 | ✅ bullish |
| `session-open-effect` | 60 | 60 | ✅ bullish |
| `speed-momentum` | **1.0** | 120 | ❌ |
| `support-resistance-levels` | **11.0** | 95 | ❌ |
| `volume-confirmation` | **16.0** | 100 | ❌ |

Nine directives have **never once emitted a bullish reading** in 24h while
occupying the denominator:

| directive | utilisation | bullish rate |
|---|---|---|
| `bollinger-band-squeeze` | 63.4% | **0.0%** |
| `gold-session-profile` | 50.0% | **0.0%** |
| `spy-qqq-relative-strength` | 46.7% | **0.0%** |
| `volatility-tools` | 37.9% | **0.0%** |
| `volume-confirmation` | 24.4% | **0.0%** |
| `support-resistance-levels` | 4.9% | **0.0%** |
| `speed-momentum` | 10.6% | 4.5% |
| `session-open-effect` | 0.9% | 0.3% |

### 3. There are THREE classes of directive output but the design has TWO slots

1. **Directional** — can be bullish/bearish
2. **Non-directional evidence** — measures something real, *never* directional
3. **Risk gate** — modulates confidence, correctly excluded

**Class 2 is the defect.** It is exempt from the gate cascade (`isGateGroup`
false) but then counted as directional capacity.

### 4. `ProtocolHealthService` already detects this — and warns on every boot

Independent confirmation of the same numbers, from a detector that already exists:

```
[xau-speed-1h]:  Only 140 of 910 maxScore points sit on directives that DECLARE a direction (15%)
[xau-speed-m5]:  Only 140 of 910 (15%)
[xau-speed-m15]: Only 140 of 910 (15%)
[xau-speed-4h]:  Only 140 of 910 (15%)
[qqq-speed-v1]:  Only 140 of 775 (18%)
[dax-speed-v1]:  Only 140 of 775 (18%)
[cac-speed-v1]:  Only 140 of 775 (18%)
[ftse-speed-v1]: Only 140 of 775 (18%)
[china-speed-v1]:Only 140 of 775 (18%)
[vix-spike-v1]:  Only 0 of 480 (0%)   ← cannot score at all
```

23 config issues across 14 protocols per boot. **A detector existed; nobody acted
on it.** That is the real failure — the same "plausible numbers with no error".

### 5. Wrote three scoring-design documents

`docs/theory/` — same six problems, three solutions, down to the maths:

- `README.md` — the six questions, comparison table, change protocol
- `scoring-design-A-directional-capacity.md` — **current design**, defect in §A.5, fix in §A.6
- `scoring-design-B-observed-evidence.md` — observed denominator (re-opens #758 deliberately)
- `scoring-design-C-confidence-weighted.md` — neutral as a confidence term

The six questions every design must answer, including the one that would have
saved weeks: **Q6 — what does a WRONG number look like?**

### 6. Built `hourly-3dir-v1` — the control protocol (DB-resident, full META.Stack)

Three directional-only directives, no risk gate, no session directive:

| | capacity | declarable directional |
|---|---|---|
| `xau-speed-1h` (typical) | 910 | **140 (15%)** |
| **`hourly-3dir-v1`** | **330** | **330 (100%)** |

Wired through the real pipeline — protocol seed data → directive group → entries
→ watchlist FK → trading bot. No custom code.

---

## Why this matters (the theory)

The recurring failure in this codebase is **plausible numbers with no error**. This
defect is the clearest instance: a protocol prints a small, stable, sensible
percentage, never crosses its gate, and nothing anywhere says "by the way, 85% of
your capacity belongs to directives that cannot contribute here."

Two engineering principles worth recording:

1. **A denominator must mean what it says.** The denominator here claims to
   measure "directional capacity" but includes capacity that cannot be
   directional. A ratio whose top and bottom measure different things is not a
   ratio.

2. **Symmetry is the test.** If a term is excluded from the numerator, the
   question "why is it still in the denominator?" must have an answer. Here there
   was none — it was an oversight, not a decision.

---

## The experiment's first result (and why it is a valid result)

`protocol_score_status` after the first tick:

```
hourly-3dir-v1   state=no-data   symbolsResolved=1   symbolsScored=0
reason: "No symbol produced a directional reading — every direction-eligible
directive read neutral or data was missing (1 symbol(s) resolved). An all-neutral
tick is data absence, not a HOLD score (#758)."
```

**This is correct behaviour, not a failure.** EURUSD was ranging in a 22-pip band
(1.15914–1.16138 over 8 hours). With no directional movement:

- `rsi-oversold` → neutral (nothing oversold)
- `macd-crossover` → neutral (no crossover)
- `ema-structure` → neutral (price not clearly above/below)

The protocol resolved its symbol, scored, and honestly reported "nothing
directional happened". Same tick for comparison:

| Protocol | state | resolved | scored | directional yield |
|---|---|---|---|---|
| `forex-session-v1` | scoring | 7 | **2** | **29%** |
| `hourly-3dir-v1` | no-data | 1 | 0 | — |
| `xau-speed-1h` | scoring | 1 | 1 | 100% |

`forex-session-v1` at **2 of 7 = 29% directional yield** independently matches the
~24% ceiling.

**Important conclusion:** the ~24% ceiling is **partly legitimate** — most of the
time nothing directional happens, and a no-score is the *correct* output. But it
is **also** compounded by the denominator defect. **These are two separate
mechanisms and both are real.** Fixing only one will not explain the number.

---

## Trap found and recorded (would have silently broken the experiment)

`seed:watchlists` resolves `protocolId` slug→UUID **at seed time**. Run before the
protocol exists, it stores the **raw slug string**, no error:

```
hourly-3dir-v1  → protocolId = 'hourly-3dir-v1'   (a string, not an FK)
LEFT JOIN protocol ON p.id = w.protocolId → NULL
```

The watchlist looks correct and resolves to nothing. **Seed order: protocols
first, watchlists second.** Recorded in repo memory.

---

## Verification performed

- `nest run build` — passes; contract validator reports **47 protocols, 423
  directive refs, no direction-contract conflicts**, 21 invariants OK
- Protocol registered live: `maxScore 330`, `directiveCount 3`, `ready: true`, no blockers
- Watchlist FK verified resolving to the protocol UUID (not a slug)
- Bot created with `maxHoldHours 12`, `mode manual`, `active 0`
- Automation tick run; `protocol_score_status` inspected and explained

---

## Follow-ups

1. **Implement Design A §A.6** — declare `canBeDirectional` on directive classes;
   exclude class-2 directives from capacity. **Not** a threshold change.
   ⚠️ Do **not** use `directionBias` for this — that attempt was reverted
   (`macd-crossover` declares `neutral` yet emitted direction 5,252 times).
2. **Wire `ProtocolHealthService`'s existing signal to something actionable** — it
   has been reporting this defect every boot. An advisory warning that nobody acts
   on is not a control.
3. **`vix-spike-v1` is 0 of 480 declarable** — it cannot score. Verify whether that
   is intended (it is a mean-reversion spike protocol) or another instance.
4. **Wait for a directional session**, then compare `hourly-3dir-v1`'s peak % to
   the ~23% baseline. That is the falsifiable test.
5. **Do NOT lower the gate threshold** as a fix. The measurement says the *number*
   is wrong, not the *threshold*.
6. `SymbolCalibration` weight multipliers are a **third** silent factor on the same
   composite — worth auditing against ADR-014 (one implementation per concept).

---

## Files

**New**
- `docs/theory/README.md`
- `docs/theory/scoring-design-A-directional-capacity.md`
- `docs/theory/scoring-design-B-observed-evidence.md`
- `docs/theory/scoring-design-C-confidence-weighted.md`
- `src/data/watchlists/hourly-3dir-v1.json`
- `nest/prisma/add-hourly-3dir-bot-761.sql`

**Modified**
- `nest/src/modules/scoring/protocols-seed-data.ts` — added `hourly-3dir-v1`
  (carries the full design rationale as comments)

**Analysis scripts (throwaway)**
- `nest/q761-gap.sql`, `nest/q761-hypothesis.sql`, `nest/q-neutral.sql`, `nest/q-3dir-check.sql`
