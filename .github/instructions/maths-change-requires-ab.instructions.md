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
| A cadence that changes how many scores are produced **for symbols that can trade** | Anything read by the scoring, gating, or execution path |

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

## ⚠️ Precondition — the runner WORKS; the constraint is now CAPACITY (#929)

> **⚠️ CORRECTED 2026-10-01 — this section was STALE and it propagated a false blocker.**
>
> It said `dispatchSideTrade()` reads `metastack_snapshot.mode` (a scoring *style*) where it expects
> a trading mode, so "no order is placed". **That defect was fixed on 2026-09-23**:
> `resolveTradeAuthority()` resolves the mode from the **bot** (`trading_strategy.mode`, which really
> is `'auto' | 'manual'`), and `ab-trade-authority.spec.ts` locks it with a canary procedure.
>
> **The stale claim was acted on.** It was read, believed, and written into
> `docs/SETTLED-DECISIONS.md` row 54 and a `DECISION` marker as the reason the exit chain stays
> advisory — **without re-measuring**. That is the exact failure this file warns about two sections
> up: *"a stale comment is not neutral: it reads as a measurement, and it costs whoever believes it."*
> A rule that cites a blocker must **re-measure that blocker**, not inherit it.

**Measured 2026-10-01**, after the stale claim was caught:

| Fact | Value |
|---|---|
| `ab_test` rows | **2** (1 cancelled, 1 complete) — the issue said zero |
| trades tagged `abTestId` | **122** — the issue said zero |
| snapshots with 2+ distinct versions | **1** (`ss-1785454844642`: 1.0.0 / 1.0.1 / 1.0.2) — a valid control/variant pair exists |
| `MAX_AB_SYMBOLS` | **4** |
| concurrent active tests | **1** |

**So steps 1–4 are all executable today. What is missing is throughput:** 4 symbols and one active
test at a time, across 27 bots, means a controlled comparison takes **weeks** to reach a sample worth
reading. That is the real constraint on the rule below — not a broken runner.

**Consequence for this rule, stated plainly:** the rule still stands, but its cost is now *time*
rather than *impossibility*. Do not describe it as "blocked"; describe it as "needs a window", and
say how long the window is.

⚠️ **Do not respond to this by editing the runner's maths to make it fire faster.** That is a maths
change without an A/B — the exact thing the rule forbids.

---

## ⚠️ NOT the maths — the owner's own correction (2026-09-23)

> *"No this is not a policy change in an active app this is a development decision. We can't duplicate
> protocols or strategies because I decide something needs changed."*

A change that **stops work which cannot become a trade** — not scoring a symbol while its market is
closed, not scoring a symbol no bot is subscribed to — is a **development decision**, not an A/B maths
change. It needs no copied configuration:

- Nothing with performance history is **overwritten** — no weight, threshold, gate or size moves.
- There is **no alternative to compare** — the alternative is doing work whose output no consumer can act on.
- Requiring a duplicate here inverts the point: a copy exists to protect a *measurement*, and there is
  no measurement to protect.

⚠️ **An agent raising "this is a maths change, so I need an A/B copy" for a cadence reduction was wrong
once already** (2026-09-23, #956). If the change only *removes untradeable work*, decide it and record
why. **Still maths, unchanged:** anything that alters what a *scored, tradeable* symbol scores, or how
much it trades.

## Related

- **#929** — the precondition blocker (snapshot `mode` conflation)
- **#944** — the falsification-test format for step 3
- **#951** — bot/scoring terminology: which layer owns which decision
- `development-status.instructions.md` — the scope rule; this file is its maths-specific extension
