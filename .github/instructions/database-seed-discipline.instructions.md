---
description: "MANDATORY before writing ANY data directly to the database (INSERT/UPDATE or an API call that persists config). Explains which tables have no seed path, why a direct write is lost on reinstall, and the seed-first rule. Read before adding a symbol, route, protocol, watchlist, bot, or setting."
applyTo: "**"
---

# Database Seed Discipline — the seed is the only thing that survives a reinstall

> **Created 2026-09-11**, after an agent (me) added a `symbol_route` row and a
> `trading_strategy` bot directly to the database, then reported the task complete.
> Both would have been **silently destroyed** by any reinstall. The user had to ask
> *"are your new elements stored in seed data?"* — the agent had not checked, and the
> answer was no.

---

## The rule

> **If you add or change configuration in the database, you MUST make the same change
> in the corresponding seed file, in the SAME change.**

A direct database write is **not** a completed change. It is a change to **one machine**.
The repo is the durable artefact; the database is a cache of it.

**Corollary — re-seeding is ADDITIVE ONLY.** `seedProtocolsToDatabase()` and
`seedDefaults()` contain **no deletes**. So:

| Action | Effect on reinstall |
|---|---|
| Add to seed | ✅ Restored |
| Change in seed | ✅ Updated |
| **Add only to DB** | ❌ **Lost forever** |
| **Remove from seed** | ❌ **Stays in the DB** — cannot be shed |

The two failure modes are opposite and both silent.

---

## 🛑 Tables with NO seed path (a direct write here is unrecoverable)

Verified 2026-09-11 by searching every `.ts`/`.js`/`.cjs` under `nest/src`,
`nest/scripts` and `nest/prisma` for writers:

| Table | Seeded by | Status |
|---|---|---|
| **`symbol_route`** | `nest/prisma/seed-symbol-onboarding.ts` | ⚠️ **ONLY writer is `Mt5Controller`** — an API call. Anything not in that seeder is lost. |
| **`symbol`** | `seed-symbol-onboarding.ts` | Partial — only the tickers listed there |
| **`symbol_protocol_assignment`** | `seed-symbol-onboarding.ts` | Partial |
| **`trading_strategy`** (bots) | `nest/src/modules/trading/strategy-seed-data.ts` via `seedDefaults()` | Partial — only `DEFAULT_TRADING_STRATEGIES` |
| **`strategy_protocol`** (subscriptions) | created by `seedDefaults()`, **not** by the API `create()` path | ⚠️ **A bot created via `POST /api/trading/strategies` gets NO subscription and can never trade** |
| **`scoring_strategy`** | created by `seedDefaults()` / on demand | Partial |
| `watchlist` / `watchlist_item` | `seed-watchlists.ts` | Unverified — `watchlist_item` was **empty** when checked |
| `protocol` | `protocols-seed-data.ts` (82KB) | ✅ Good coverage |
| **`global_setting`** | *(none found)* | ⚠️ **No seeder** — settings are DB-only |
| **`symbol_route` rows with `provider: 'binance'`** | *(none)* | ⚠️ `brokerId: 0` crypto routes have no seeder (seed 2026-09-10, DB-only) |

**If you write to a table in the ⚠️ rows, your change does not exist in the repo and
will not survive a reinstall.**

---

## How to do it correctly

### 1. Find the seeder for the table you are changing

```powershell
# What writes this table?
Select-String -Path nest\src\**\*.ts,nest\scripts\*.cjs,nest\prisma\*.ts -Pattern "symbolRoute\s*\.\s*(create|upsert)"
```

If **nothing** seeds it, that is the finding — raise an issue rather than
adding a second unsanctioned write path.

### 2. Add the row to the seeder's DECLARATIVE list

Seeders must be **idempotent** (`upsert`) so re-running converges rather than
duplicating. Then run the seeder and confirm it reports your row.

### 3. ⚠️ Make the upsert carry EVERY field the row depends on

An `upsert` whose `update` clause omits a field **silently leaves the DB value alone**,
so a re-seed cannot *repair* a wrong value — it can only insert. This bit a real fix:
the VIX route re-seeded with `brokerSymbol: null` because `update` did not set it, so
the "restored" row was **not** a faithful copy of what worked.

```ts
// ❌ CANNOT repair an existing row
update: { enabled: true, note: r.note },
// ✅ converges the row to the declared state
update: { enabled: true, note: r.note, provider: r.provider ?? 'mt5', brokerSymbol: r.brokerSymbol ?? undefined },
```

### 4. Prove it round-trips — do not assume

Delete the row, run the seeder, verify it comes back **identical**:

```powershell
# capture → DELETE the row → run the seeder → compare
$env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
$env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"; npx ts-node prisma/seed-symbol-onboarding.ts
```

A seeder that *runs* is not a seeder that *restores*. Only the delete-and-rebuild
test proves it. Record the result in your handoff.

### 5. Note it in the handoff

Say which seeder you updated and that the round-trip was verified. See
`agent-handoff.instructions.md`.

---

## ⚠️ Creating a bot via the API is INCOMPLETE

`POST /api/trading/strategies` calls `TradingStrategyService.create()`, which does
**not** create a `strategy_protocol` subscription. `SignalQueueService.syncQueues()`
routes **by subscription, not by `trading_strategy`**:

```sql
SELECT sp.strategyId, sp.protocolId, ts.symbol AS strategySymbol
FROM strategy_protocol sp
JOIN trading_strategy ts ON ts.id = sp.strategyId
WHERE ts.active = 1
```
```ts
if (sub.protocolId !== rec.protocolId) continue;   // no subscription → never queued
```

**A bot with no subscription silently never trades.** `seedDefaults()` creates the
subscription; the API path does not. This is a live defect — a bot that appears active
in the UI and produces no queue entries, with no error anywhere.

⚠️ `seedDefaults()` hardcodes `role: 'long'`. A SHORT bot must be `role: 'short'`.

---

## 🔍 "Why isn't this bot trading?" — use these two, in this order

```powershell
# 1. WHY can this bot not trade? Names the specific fault, per bot.
node nest/scripts/audit-bot-activation.cjs
#    reports: NO-BARS | NO-SUBSCRIPTION | BELOW-FLOOR | NOT-TRADEABLE-HERE | INACTIVE

# 2. Has the DATABASE drifted from the SEED? Read-only — writes nothing.
curl.exe -s -X POST "http://localhost:3201/api/trading/strategies/seed?dryRun=true"
```

**`nest/scripts/audit-bot-activation.cjs` is the entry point for "why can't this bot trade".**
It exists because the US500 incident (2026-09-15) produced a bot that looked perfectly configured
in the UI while the bridge refused every order — three separate faults, all invisible.

**`?dryRun=true`** is the second question, and it is different: the audit asks whether a bot *can*
trade, this asks whether the **configuration still matches `strategy-seed-data.ts`**. It reports
`changes: [{ bot, fields[] }]` without writing, so it is safe to run any time — and running it is
how you find out that a bot's size, mode or time-stop was changed in the database and never put
back into the seed.

### ⚠️ Convergence is only safe in ONE direction: seed → database

`seedDefaults()` converges as of 2026-09-23 (#833). That means **an out-of-date seed file is now
destructive**: it will revert deliberate database-only changes. It did exactly that on the first
run — flipping five bots `auto` → `semi-auto` (which stops them dispatching) and writing `null`
over four gold time-stops.

**Before trusting a convergent seeder, reconcile the seed to reality.** Run the dry run, read
`changes`, and for each field ask "is the seed or the database right?" — then fix the one that is
wrong. Fields the seed **omits** are left alone on purpose; only declared fields are converged.

---

## Related

- **#791** — protocol seed is stale; `dump-protocol-seed.cjs` was deleted 2026-07-26, so it cannot be regenerated
- **#801** — `trading_strategy.protocolId` is slug-or-UUID; lookups return wrong answers silently
- **#803** — inactive protocols still score and persist via `SpeedScanService`; `active=0` is not a kill switch
- `database-schema.instructions.md` — the 10 unmodelled tables; `db push` is DESTRUCTIVE
- `change-completion.instructions.md` — Gate 3 (state): does the running system agree with the config that describes it?
- `development-status.instructions.md` — pre-release, single machine, no users. Editing core install files is correct.
