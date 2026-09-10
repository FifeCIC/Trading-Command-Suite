# `spy-day-v1` — root cause: the signal denominator flips between groups

**2026-09-10.** Traced end-to-end. This is the same mechanism behind `spy-speed-v1`,
`vix-spike-v1` and `qqq-speed-v1` going quiet, so it is the bug to fix first (before #757).

## Symptom

`spy-day-v1` writes a score row every tick with `composite = 0`, `trading_signal = HOLD`, and a
fresh timestamp. The Ladder card therefore shows "Live" and a timestamp with nothing meaningful.

## Root cause

In `protocol-gating.service.ts` the **signal denominator** (`signalMax` → stored as `rawMax`) is
summed per group from only the directives whose **runtime** `signalClass` is bullish/bearish **on
that tick**:

```ts
if (inSignal) {            // inSignal = !isGateGroup && directional && directionAllowed
  signalRaw += result.score;
  signalMax += maxScore;   // <-- denominator grows ONLY from directives that fired
}
...
if (signalMax === 0) {
  inactiveGroupIds.push(groupId);
  subMaxTotals[groupId] = 0;      // whole group contributes nothing to the denominator
}
```

So a group that produced **no directional reading on this tick** (insufficient data, all-neutral,
or a directive returning nothing) contributes `0` to the denominator. When that happens to *every*
group, `rawMax = 0` and `composite` is `0 / 0 → 0` with `signal = HOLD`.

The real rows show the denominator doing exactly that, switching group tick to tick:

| timestamp | `rawMax` | `rawComposite` | `subScores` | `subMaxTotals` |
|---|---|---|---|---|
| 11:55:47 | 80 | 30 | `{sentiment: 38}` | `{risk:0, sentiment:80, technical:0}` |
| 11:53:16 | 90 | 50 | `{technical: 56}` | `{risk:0, sentiment:0, technical:90}` |
| 11:48:25 | **0** | **0** | `{}` | (all zero) |
| 11:42:25 | **0** | **0** | `{}` | (all zero) |

Three separate things are wrong with that:

1. **The denominator is not stable.** The same protocol scored `/80` one minute and `/90` four
   minutes earlier. A percentage whose denominator changes per tick is not comparable over time —
   the score history is meaningless as a series.
2. **`rawMax = 0` is indistinguishable from "no data".** `0/0` silently becomes a legitimate-looking
   `0` with `HOLD`, so absence of data is written to the DB as a *reading*.
3. **Two of the last twelve rows are `rawMax = NULL`** — a third state (fields absent entirely),
   which the UI reads as "no score". So the same protocol emits three different shapes.

## Why it matters beyond the card

- Any downstream consumer of `rawComposite ÷ rawMax` (the Ladder family fallback, rarity
  percentile, opportunity comparison, the outcome tracker) is comparing values normalised against
  *different* denominators.
- The stored `HOLD` is a claim, not an absence. Nothing in the pipeline can tell the two apart.

## Options (needs a scoring-architecture decision)

| Option | Effect |
|---|---|
| **Stable denominator per protocol** (🟢 recommended) | Denominator = sum of maxScores of all *included, direction-eligible* directives for the protocol, computed from config — not from which directives happened to fire. Score becomes a true percentage of protocol maximum, comparable tick to tick. A group with no reading then contributes 0 to the *numerator* only, which correctly lowers the percentage. |
| Keep per-tick denominator, mark the row | Store `rawMax: 0` as `no-data` with a reason instead of `HOLD`, and let the UI show "no directional signal this tick". Honest, but leaves the percentage non-comparable. |
| Skip persistence when `rawMax === 0` | Stops writing phantom zeros, but the Ladder then shows a stale timestamp — and the underlying flapping remains. |

⚠️ Option 1 changes the meaning of every stored score, so it needs the theory decision first
(`docs/scoring-architecture.md`, `docs/canonical-directive-reference.md`) rather than a quiet
code change. It is also the option consistent with the directive-weighting rule in the
`directive-scoring-rules` notes: maxScore expresses *importance*, so the protocol maximum should be
a property of the **protocol config**, not of what fired in a given minute.

## Also confirmed while tracing

The `signalClass` → denominator rule is also why `spy-speed-v1`, `vix-spike-v1` and `qqq-speed-v1`
wrote their last rows at 07:57 and then stopped: at that point their rows read `rawMax: 0`, and
they have not produced a directional reading since — so no meaningful score has been written for
four hours while `protocol_score_status` still reports `scoring`.

**The cheapest high-value fix remains the status one:** `protocol_score_status` should report
`stalled` when a protocol claims `symbolsScored > 0` but has written no `Score` row in N minutes.
That turns this silent 4-hour outage into a visible badge, independent of how the denominator is
resolved.
