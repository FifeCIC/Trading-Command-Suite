# Position Lifecycle Change Guide

**Status:** active
**Category:** C (reference / contract)
**Created:** 2026-09-30
**Last updated:** 2026-09-30
**Owner:** primary agent

---

## Why this document exists

On 2026-09-30 one XAUUSD position lost **322.67** — **16× the next worst trade of the day**, and more
than the whole day's other trades made back. It should not have been possible to open it, it was not
possible to manage it, and the row that records it **cannot have produced that loss**.

This document does two things, and nothing else:

1. turns that incident into **rules a change must satisfy**, usable as a review lens for bot activity
   and algorithms;
2. specifies the **one interface** the owner needs to manage open positions instead of watching
   MetaTrader (both accounts), Pepperstone, and TCS side by side.

It is **not a task list**. Every open piece of work is a GitHub issue, named inline and listed under
*Related*.

---

## 1. The incident, from the broker's own deals

Position `152703882760`, XAUUSD BUY, MetaQuotes-Demo (broker 2, **GBP** account).
Source: MT5 bridge `/history/deals?days=2` — 11 deals.

| time (UTC) | volume | price | comment on the deal |
|---|---|---|---|
| 10:16:10 | 0.01 | 4187.82 | `TCS Gold Position 4H copy` |
| 12:32:28 | 0.01 | 4216.90 | `TCS AB-A 929 measurable run` |
| 12:32:28 | 0.01 | 4216.90 | `TCS AB-B 929 measurable run` |
| 12:34:29 | 0.01 | 4210.68 | `TCS AB-A …` |
| 12:34:29 | 0.01 | 4210.66 | `TCS AB-B …` |
| 12:36:28 | 0.01 | 4209.52 | `TCS AB-A …` |
| 12:36:28 | 0.01 | 4209.52 | `TCS AB-B …` |
| 12:38:28 | 0.01 | 4209.84 | `TCS AB-A …` |
| 12:38:28 | 0.01 | 4209.78 | `TCS AB-B …` |
| 12:42:26 | 0.01 | 4213.61 | `TCS AB-A …` |
| **14:37:00** | **0.10** | **4166.68** | `[sl 4166.68]`, profit **−322.67**, deal reason 4 = **stop loss** |

**All eleven deals share `positionId 152703882760`.** Ten fills totalling **0.10 lots** were opened
into a position that already existed, opened by a **different strategy**, and closed as one 0.10-lot
unit by **that position's** stop — which sat at 0.505% while both A/B arms declare `slPct: 1`. The
arms' own stops were never the binding one.

The app holds **one row** for it:

| app column | value | truth |
|---|---|---|
| `quantity` | **0.01** | **0.10** |
| `entryPrice` | 4187.82 | only the **first** of ten fills (VWAP ≈ 4209.52) |
| `pnl` | −322.67 | correct — and impossible for 0.01 lots over a 21.14-point move (≈ 16) |
| `strategy` | `AB-A 929 measurable run` | comment-derived, not an A/B record |
| `abTestId` / `abTestSide` | **NULL / NULL** | no arm — so the experiment cannot see its own loss |
| `pnlInvalid` | **0** | asserts the row is usable |
| `closeReason` | `broker:sl` | correct |

⚠️ **The test that produced it is still running, and nothing stopped it on purpose.** `ab_test` row
`b50727ee` (*"#929 measurable run — tradeThreshold 55 (v1.0.0) vs 10 (v1.0.1)"*, `symbols:
["XAUUSD"]`) is `status: running`, started **2026-09-25 23:29**, `endAt NULL`.

Measured 2026-09-30 17:20:

| what the test produced | count |
|---|---|
| trade rows carrying the test id | **104** — 56 on 09-28, 48 on 09-30 |
| of those, with an exit price and a P&L | **1** |
| `closed` but with no exit price | **12** |
| `rejected` | **91** |

**103 of 104 rows cannot contribute to a comparison.** What ended its day was not design: at `13:14`
orders were refused for **negative margin** (*"need 0.00, have −81.89"*), and at `15:29` by a
**daily loss limit** (*"−240.83 vs −100.00 [broker 2]"*). The last attempt was **15:33**, and both
bridges report `tradeAllowed: true`.

**And the brake lets go every day.** It is not the app's — it is enforced in the **bridge**,
`scripts/mt5-bridge/mt5_bridge_v2.py:1680`, from `MT5_MAX_DAILY_LOSS` (configured `100`). Its window
is `datetime.now().replace(hour=0, …)` — **local midnight** — summing today's deal profit. So the run
is not stopped, only **paused until midnight**, and it resumes on its own.

That is the finding worth keeping: the only thing that stopped this bleeding was a **bridge-level
risk cap, configured outside all of the app's exit machinery**, and it resets daily.

Also worth knowing: `threshold 55 vs 10` makes the variant fire near-constantly — two orders every
~2 minutes — which is how one idea accumulated a ten-fill position.

## 2. Seven failures → seven rules

Each rule is a question to ask of **any** change to bot activity or an algorithm.

| # | What failed (evidence) | Rule |
|---|---|---|
| **1** | **An A/B arm cannot own a position.** Nine arm orders joined a stranger's position; each also **rewrote its comment** — the same ticket read `AB-B` at 12:32 and `AB-A` from 12:42 | **An experiment must own what it trades.** On a netting account an order *cannot* isolate an arm. Isolation must come from the account, from a symbol lock, or the test must not run live. See **#807**, **#929** |
| **2** | **The row's size cannot produce its own P&L** — `0.01 × 21.14` ≠ 322.67 — and `pnlInvalid = 0` | **Size × price move must reconcile to P&L, or the row is invalid.** A row that cannot be true must be marked, never averaged into a verdict. See **#1014** |
| **3** | **The loss is invisible to the experiment that caused it**: the −322.67 row has `abTestId NULL`, while all 42 rows that *do* carry the test id have `exitPrice NULL, pnl NULL` | **A trade must carry its origin structurally.** If the origin is absent, the trade must be excluded from every verdict *and* the exclusion must be counted. A loss no verdict can see is a silent loss. See **#1014** |
| **4** | **Unmanaged for 2 h 20 m.** 26 guardian warnings, `Owner could not be established … not managed this tick` | **Ownership must resolve without parsing a comment.** A comment is mutable text that another order can overwrite. Ownership is a structural fact. See **#1030**, **#1033** |
| **5** | **The declared cap did not bind.** Both arms declare `maxPyramidTiers: 1`; **nine** adds landed | **A size/tier cap binds the aggregate position, not the order.** On a netting account an order is an increment to a position, so per-order checks cannot enforce a position limit. See **#721**, **#807** |
| **6** | `trade.scoringStrategyId = 4d9bc5ef-…` resolves to **nothing** — real ids look like `ss-…` | **Every identifier on a trade resolves, or is absent.** Two identifier spaces in one column read as a valid link and return nothing. See **#801** |
| **7** | **33 orders rejected** while the position stayed open; the runner kept firing every 2 minutes | **A rejection escalates; it does not retry.** Retrying into a refusal is not a strategy, and a refusal that changes nothing is invisible. |

## 3. The review lens — ask these of any bot or algorithm change

Written as questions rather than a checklist, because the answers are the point.

- **Ownership.** After this change places an order, how is the resulting position attributed to the
  bot that owns it — and does that path survive another component rewriting the comment?
- **Aggregation.** Does every cap this change relies on bind the **net position**, or only one order?
- **Arithmetic.** Can the recorded row be checked against the broker? If size × move ≠ P&L, which
  component is wrong, and does anything notice?
- **Attribution of outcomes.** Can the experiment or verdict that produced this trade see it back?
  If not, what counts the trades it cannot see?
- **Orphan behaviour.** If this component stops — crashes, is disabled, is rate-limited — which
  mechanism manages the positions it created? Name it. "None" is an acceptable answer only if it is
  stated.
- **Refusal.** What does the app do when the broker says no, and where does that appear?

### How far the bot book is from that design today

The declared design is *"each bot runs a series of rules that can use the bot's own settings"*.
Measured 2026-09-30:

| | |
|---|---|
| Guardian rules | **13** — **11 are `scope: 'global'`**, only **2** are per-bot (`simulated-tsl`, `exhaustion-observer`) |
| Those 2 rules' enforcement | **`display-only`** — neither can act |
| Active bots that enable either | **0 of 39** |
| Active bots with a hold limit (`maxHoldHours`) | **29 of 39** — **10 have none**: BTC, EURUSD, FRA40, GER40, UK100, US30, US500, VIX, XAGUSD ×2 |
| Unattributed positions | `DEFAULT_MAGIC = 234000` means *no bot*, and the guardian reports attribution as `viaMagic` / `viaComment` / `unresolved` — **`viaComment` is the one that failed above** |

So the per-bot layer exists but is **inert**, and the global layer is the one that acts. A bot cannot
currently express a different rule-set from another bot — which is the thing the design is for.

## 4. The interface: one place to manage every open position

The requirement, in the owner's words: *manage open positions instead of watching MT5 + Pepperstone +
TCS.* Today there are **three systems and two accounts**, and the only surface that shows the real
book is the broker terminal.

### What it must read

| | |
|---|---|
| **Input** | every open position from **every** active bridge (not one), joined to the bot book and the recorded `trade` rows |
| **Output** | one list, one row per **broker position**, with the contributing orders beneath it |
| **Transform** | the broker position is the truth; the app's row is *evidence about* it, never a substitute |
| **Fails when** | a position the app cannot manage is omitted from the list — silence is the defect |

### Required columns, per position

| Column | Why it is not optional |
|---|---|
| **account / broker / server** | two accounts exist; a position without its account is not actionable |
| **symbol, side, net size, VWAP, fill count** | *size* and *how it got there* — the incident was 10 fills |
| **current price, P&L, P&L %** | the number the owner actually watches |
| **owner: bot + protocol, or `UNOWNED`** | and `UNOWNED` must be loud, because it means nothing manages it |
| **`managed by` — and if not, WHY** | the single highest-value addition: the app already computes *unresolved attribution*, *the single-bridge gap* and *market-closed backoff*. Surfacing the reason per position is what turns three systems into one |
| **SL / TP, distance to each, and the loss remaining to the stop** | in **money**, not percent — "`−5.95 more`" is a decision; "0.19%" is not |
| **age vs the bot's hold limit** | or `no limit set`, which is currently silent |
| **exit verdict + conviction, labelled ADVISORY** | it must never read as something that acts |
| **peak and give-back** | it *was* +0.66% and gave it back — see **#978**, **#979** |
| **last action taken on it, by what, and when** | including refusals |

### What it must let the owner do

Close · partial close · move the stop · and **adopt an owner** — the capability that does not exist
and that the incident needed most, because a position with no resolvable owner is one no mechanism
will ever manage.

**Specified in full, with acceptance criteria, in #1037.**

### What it must not do

- show a row whose size cannot produce its P&L;
- present an order-ticket row as if it were the position (**#1014** — the 10× overstatement);
- print a verdict, a limit or a stop that **nothing enforces** without saying so.

## 5. What is NOT established

Stated so the next reader does not over-read this document.

- **The account's declared margin mode was not read.** The code's own `#1014` comment says *"this
  NETTING account"*, and the behaviour confirms it — nine orders, one `positionId` — but the account
  flag itself was not queried.
- **Which change enabled live A/B orders was not traced through git history.** The code path is
  `resolveTradeAuthority()` in `ab-test.service.ts`, which reads the *owning bot's* mode instead of
  the snapshot's scoring style, and `trading_strategy.mode = 'auto' × 25`. That is what makes the
  order branch reachable; when it landed was not checked.
- **This may not be the only such position.** The incident was found because the loss was large. No
  sweep was run for other positions that merged more than one owner.

## Related

- **#1037** — the position-management interface this document specifies
- `.github/PRIMARY-GOALS.md` — the order of exit work this incident belongs to
- **#1014** — order ticket vs position id; the reconciler's 1-of-N problem
- **#807** — MT5 netting vs hedging; the structural cause of the merge
- **#929** — A/B; its measurement cannot be valid while an arm cannot own a position
- **#1030**, **#1033** — management and reads each address one bridge
- **#801** — a column that holds a slug *or* a UUID
- **#721** — duplicate-position policy and scale-in
- **#978**, **#979** — peak and give-back, for the interface
- **#916**, **#917** — the payoff defect (loss magnitude)
- `docs/SETTLED-DECISIONS.md` — check before changing anything this document names
