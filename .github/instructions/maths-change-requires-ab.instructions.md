---
description: "MANDATORY before changing any number that affects a trading decision — scoring weight/maxScore, threshold, gate, sizing, risk multiplier, band, or cadence. The owner requires a COPIED configuration and a monitored comparison instead of an in-place edit. Read before editing 'the maths'."
applyTo: "**"
---

# Maths Changes Require an A/B Copy

**Owner policy, stated 2026-09-22:**

> "We're not editing the maths without A/B testing in place going forward. I don't mind agentic AI
> making adjustments either as long as it uses the A/B system to create a copy and we monitor if the
> change works or not."

---

## Why this rule exists — a worked example, the same day

An agent lowered a live trading value (`signals.manualTrade.size`, 0.1 → 0.01). The intent was
harmless: a smaller manual default.

**It broke bot routing for VIX.** `signal-envelope.service.ts` was passing that *manual* default as
the feasibility size for **every** envelope, including bot-driven ones. VIX's floor is 0.1, so at
0.01 the envelope became unroutable — a change in one place, a failure in another, and nothing
reported an error. Plausible output, no exception.

That is the class of change this rule covers: **a number edited in place, evaluated by a consumer
nobody was thinking about.** A copied configuration compared side by side would have shown the
divergence without touching the incumbent.

---

## What counts as "the maths"

| Yes — copy first | |
|---|---|
| Directive `maxScore` / weights | Gate thresholds (`ENTRY_THRESHOLD`, `STRONG_PCT`) |
| Style thresholds (`style-thresholds.ts`) | Sizing (`baseSize`, risk %), risk multipliers |
| SL / TP percentages | Bands, percentiles, rarity cut-offs |
| A cadence that changes how many scores are produced | Anything read by the scoring, gating, or execution path |

## What is NOT the maths — do not slow down for these

- Naming, comments, log text, error wording
- UI ordering, labels, colours, layout
- **A bug fix that restores an intended value** — say so explicitly, cite the intent, and show the
  evidence. (The VIX fix above was this: the bot's own `baseSize` should always have been used.)

A rule that over-fires gets ignored. Narrow beats broad.

---

## The rule

1. **Do not overwrite a value that has performance history.** Create a **copy** — a second scoring
   strategy / protocol version / bot — that carries the change.
2. **Both configurations must exist at the same time** so they can be compared. A copy that replaces
   the original is not a copy.
3. **Record the comparison intent** on the issue, in #944's format: what you expect to change, and
   the observation that would falsify it.
4. **The incumbent is not deleted until the comparison reports.**

---

## ⚠️ Precondition — the A/B runner cannot place orders yet (#929)

`dispatchSideTrade()` reads `metastack_snapshot.mode`, which holds `"score"` (the scoring *style*),
and compares it against trading modes `'auto'|'manual'|'semi-auto'`. Every stack therefore evaluates
as "not auto" and takes the intent-only branch — **no order is placed.**

Measured 2026-09-22: A/B test "XAU M15 group vs maxscore weighting" ran from 12:19:37. **10 rows
reported `EXECUTED` with `brokerTicket: NULL`**, each carrying the reconciler comment *"no broker
counterpart (stranded row)"*, in 5 identical pairs.

**So steps 1–3 are executable today; step 4 (monitoring) is not, until #929 is settled.**

⚠️ **Do not respond to this by editing the runner's maths to make it fire.** That is a maths change
without an A/B — the exact thing the rule forbids.

---

## Related

- **#929** — the precondition blocker (snapshot `mode` conflation)
- **#944** — the falsification-test format for step 3
- **#951** — bot/scoring terminology: which layer owns which decision
- `development-status.instructions.md` — the scope rule; this file is its maths-specific extension
