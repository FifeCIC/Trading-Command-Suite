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
| `AB_MAX_SYMBOLS` (default) | **8** — env-overridable; the issue said 4 |
| `AB_MAX_ACTIVE` (default) | **2** — env-overridable; the issue said 1 |
| distinct orders behind the 122 tagged trades | **17** |
| arm rows with a NULL `pnl` | **91 of 110** |
| the one completed run's two arms | **−11.80 / −11.80 — identical** |

⚠️ **The capacity figures in the row above were ALSO read from an issue rather than measured**, on the
first attempt at this correction. Both are env-overridable and were widened on 2026-09-22.

### ⚠️ RE-MEASURED 2026-10-06 — the ATTRIBUTION claim above is NOT what the data shows

> This section said *"the binding constraint is ATTRIBUTION: the positions merge, and the volume split
> is not resolving, so a verdict has nothing readable to stand on."* That was carried from a single
> observation on 2026-10-01 and, per the rule two sections up — *“a rule that cites a blocker must
> re-measure that blocker”* — it was re-measured. **It is wrong as stated.**

`GET /api/automation/ab-tests/:id/results`, both tests, 2026-10-06:

| Test | `unattributed` | attribution counters | verdict |
|---|---|---|---|
| `b50727ee` (running) | **0** | attributed **104** · counted **13** · excludedRejected **91** | `insufficient-data` — **8 vs 5** closed |
| `a1bfc533` (complete) | **0** | 1 trade per arm | `insufficient-data` — **0 vs 0** closed |

- **Attribution RESOLVES.** Every tagged row carries a side, and `computeResults()` attributes by
  `trade.abTestSide` — not by the mutable `brokerComment` (#929's own fix). `unattributed: 0`.
- **The 91 `excludedRejected` rows are HISTORICAL** — dated 09-28 and 09-30 only, i.e. before #1039's
  write-side fix. **No rejected A/B row has been written since 2026-09-30.**
- ⚠️ **The "identical arms" question is ALREADY SETTLED — do not re-open it.** R40 records the arms
  entering and exiting at the same prices for identical P&L, and traced it to **R18 / #1054**: the two
  stacks in *that* pair differ only in `weightStrategy`, which `protocol-gating.service.ts`
  (`DECISION`, register row 32) declares **INERT** — it selects nothing — so **no number of trades
  could have produced a difference.** #1054 was closed 2026-10-06 on that arms diff.
  That is a *different and more fundamental* limit than throughput, and it applies **to that pair
  only**. `b50727ee` is the measurable one: `arms.changedFields: ['tradeThreshold']`,
  `inertFields: []`, `measurable: true`.

**The actual constraint is SAMPLE SIZE, and the verdict machine handles it correctly.** It refuses to
name a winner on 8 vs 5 and prints exactly why — *"noise wearing a result's clothes (#929)"*. A small
sample is not a defect in the runner; it is the runner declining to over-claim, which is the behaviour
this repo wants. `arms.measurable` reads **true** for `b50727ee` (`changedFields: ['tradeThreshold']`,
`inertFields: []`).

⚠️ **One observation, left explicitly UNEXPLAINED.** The variant (`tradeThreshold` **10**, clears ~70%
of scores) holds **fewer** closed trades than the control (**55**, clears ~10.7%) — **5 vs 8**, the
opposite of what signal frequency alone predicts. A candidate explanation is that the two arms' orders
net against each other on the same symbol and netting account, so only one position exists at a time.
**That is a hypothesis and has NOT been measured — do not cite it as the cause.** It is named here so
the next reader starts from the right question rather than re-deriving the old, wrong one.

**Consequence for this rule, stated plainly:** the rule stands, and the cost is no longer "cannot
produce a result". It is **"needs a large sample, and the two arms do not accumulate it at the rate
their signal frequencies suggest"**. Practically: budget a **long** window, and if a run sits at a
handful of trades, the question to ask is *why the low-threshold arm is not trading more* — not *why
the verdict is unreadable*.

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
