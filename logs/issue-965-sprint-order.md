## Sprint re-confirmed 2026-10-07 — with two new measured findings folded in

**This issue is the sprint.** No new epic or sprint is created (per its own *"What NOT to do"*). The
owner has directed: **prioritise backtesting, wrap this area of the app ASAP.**

Owner's framing, restated because it matches this issue exactly:

> *"an A/B copy needs to have a secondary account assigned, and both accounts need to be accessible, else
> both strategies shouldn't run OR the A/B copy is assigned backtesting status… the manual backtesting
> runs both A and B on the same data and only then can we do a comparison AND the comparisons can only be
> done on the backtesting session."*

That is this issue's own conclusion (steps 1–4), reached independently on 2026-09-23.

---

### ⚠️ NEW FINDING 1 — the live A/B path bypasses the pipeline (P0)

**Measured today.** `dispatchSideTrade()` (`ab-test.service.ts:407`) goes:

```
tradeMode check  →  adapterFactory.create(brokerId)  →  adapter.placeOrder(...)
```

| Gate | Normal trade | A/B live order |
|---|---|---|
| Bridge credential binding (#1035) | ✅ | ✅ — one `order_send` site |
| Route integrity (#914) | ✅ | ✅ — inside the adapter |
| **Signal queue** | ✅ | 🛑 **bypassed** |
| **Duplicate guard** | ✅ | 🛑 **bypassed** |

**Owner ruling: unacceptable.** *"There should only be ONE pipeline from symbol registration to order
closing… This requirement will not change unless I specifically state that we need another route to the
point of order placement."* This is the project's stated biggest fear — a path to trading that skips
parts of the designed process.

**Immediate mitigation applied:** the running test `b50727ee` was **stopped** (status `complete`). No live
A/B order path is currently active. It had one bot on one account, so it could not satisfy the two-account
requirement anyway.

**The fix, in the owner's terms:** a live A/B pair may place orders **only** when it holds two bound,
distinct, accessible accounts — and when it does, it must go **through the same pipeline** as any bot.
Until the account binding exists, **the live path places nothing.** That is the correct interim state,
not a workaround.

---

### ⚠️ NEW FINDING 2 — same-data was never enforced (feeds step 4)

Step 4 says *"run both protocols of a real pair and compare"*. Nothing enforces that the two runs share a
**symbol and a date range**, so `POST /runs/compare` will happily compare two different experiments.
Owner: *"A/B testing is meant for the purpose of adjusting an established strategy and measuring the
benefits/losses of that change. Different symbols tell us nothing."*

**This is the guarantee that makes a comparison mean anything** and it belongs in step 4, not later.

---

### NEW FINDING 3 — the pairing is specified but not implemented

Owner: *"it was well stated to have some sort of mechanism such as a pairing ID… I thought it had been
implemented already."* **Correct — it is #963** (the pair LOCK: *both sides active together, one declared
difference*). It is **open**, and *"A and B is already established"* is true at the bot/protocol level
(`duplicatedFromId`, `derivedFrom`, distinct magics 234104–234139) — **what is missing is the experiment
identity that links two `backtestrun` rows as A and B of one test, and the same-data check above.**

---

### NEW FINDING 4 — accounts are per-user data, and the store does not exist (LOW, owner-deferred)

Owner: *"don't hardcode these accounts — it doesn't work for a new user… prepare for many users that will
input different accounts."*

New rule written: **`.github/instructions/external-systems-are-data.instructions.md`**. Measured state:

| Concern | Store | Status |
|---|---|---|
| Broker capability | `broker_config` | ✅ exists — **capability only** |
| Broker's tradable symbols | `broker_symbol` | ✅ exists |
| Symbol → broker route | `symbol_route` | ✅ exists |
| **Accounts / servers / credentials** | 🛑 **none** — they are `MT5_ACCOUNT_n` / `MT5_PASSWORD_n` env vars incl. hardcoded terminal paths | ❌ |

Both current accounts do **not** trade the same symbols, so selecting an account for an arm needs a
**viability check** — owner marks this **lower priority**. Tracked separately.

---

## The order — revised, backtesting first

| # | Item | Source | Why here |
|---|---|---|---|
| **P0** | **The live A/B path stops placing orders** unless the pair holds two bound, distinct, accessible accounts — and then only **through the pipeline** | New | Owner ruling. The only item that is a live-safety gap. Mitigated by stopping the test; the guard is the fix |
| **P1** | **The sample bar** — `runs/compare` refuses to name `best` below a stated per-side count, reporting `insufficient-data` **with the counts** | This issue, step 1 | **Every entry point below feeds this verdict.** Measured: it named a winner on **3 trades** |
| **P2** | `compare` vs `run` disagree on the same run | This issue, step 2 | A viewer that disagrees with its source cannot be a second source. Find which is right first |
| **P3** | **Backtest a STRATEGY (`botId`)** — one call, not a hand-assembled request. ⚠️ Read **#843** first (backtester sizes 4 ways, live sizes 1) | This issue, step 3 | This is "prioritise backtesting" — a bot, not a protocol, is the unit A/B adjusts |
| **P4** | **Test a PAIR** — the **pairing id** (#963) + the **same-data guarantee** (equal symbol + dates, stored on the pair) | This issue step 4 + New Finding 2 | The measurement the whole sprint exists for |
| **P5** | Surfaces — **#819** replay view, then **#606** | This issue, step 5 | Owner has already said *"build this now"* |
| **P6** | Rename out of A/B — **#962** | This issue, step 6 | 87 refs / 30 files; pure jargon debt, safe last |
| **P7** | **Dynamic account store + A/B profile account selection + viability check** | New Finding 4 | Owner-deferred. The rule is in place; the store and UI follow |

⚠️ **P0 and P1 both touch the measurement before it is used by anything.** That ordering is deliberate
and is this issue's own instruction — *"do this FIRST, before any new entry point"*.

⚠️ **Do NOT build the live-pair measurement.** This issue measured that it cannot work (the account nets),
and today's audit found a second reason: **one close booked across 10 rows** (9× `−32.267` + 1× `−322.67`
for a **single** netted position) — #1014's predicted overstatement, now measured.

## Related, not re-scoped here

- **#714 — Unified signal pipeline** — the owner's "ONE pipeline" ruling is that issue's whole subject. **P0 is its A/B-shaped instance**
- **#807** — two-leg pair execution feasibility (netting vs hedging)
- **#1014** — the volume split that makes a netted row's P&L safe
- **#721 / #771** — duplicate-position policy; short-side limits that assume LONG
- **#963** — the pair LOCK (the pairing id) · **#952** — the runner is unreachable from the app
- **#1008** — `xau-speed-v1-copy` A/B intent written, comparison never started
