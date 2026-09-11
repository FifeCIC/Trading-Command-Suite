# Handoff — Why the project loops, and the three tools that now detect it

**Date:** 2026-09-11
**Trigger:** project owner's question — *"I'm struggling to understand why there's so many issues
despite AI looking over and working on these areas many times over."*
**Type:** Investigation + tooling + one live defect fixed (#792's mechanism)
**Status:** tools built and verified; 2 protocol-level items left for the owner to decide

---

## The answer to the question

**Most of the churn is not new bugs. It is old decisions being re-opened by agents who did not know
they were settled.** Three compounding mechanisms, each measured rather than assumed.

### Mechanism 1 — issues are closed on INTENT, not on ENFORCEMENT

| | |
|---|---|
| **Worked example** | **#638** "Scoring architecture: separate gates from scores" — opened and closed **2026-08-16**, ~4 hours |
| Its own pre-close checklist | ticked *"**3. No constant floors** — `HOLD_FLOOR` / `ENTRY_THRESHOLD` flat constants removed"* |
| Reality today (2026-09-11) | `ENTRY_THRESHOLD = 40` is **live** at `protocol-gating.service.ts` **L324** |
| And beside it | a code comment recording that this same constant already caused an incident on **2026-08-12** |

**A checklist box is a claim. A build-time guard is a fact.** Nothing enforced #638's decision, so
nothing prevented **#789** and **#790** from rediscovering the same class **26 days later**.

### Mechanism 2 — a seed fix is not a database fix

`ProtocolDbService.seedProtocolsToDatabase()` is **upsert-only**: creates and updates, **never deletes**.

- removing a directive from the seed does **not** remove its DB row
- moving one between groups does **not** move its DB row
- **re-seeding cannot converge them**

⚠️ **The diagnostic lies.** The seed endpoint returns `entries: N` counting rows **upserted**, not
rows that **exist**. It reads exactly like a successful removal.

### Mechanism 3 — nothing recorded which areas were settled

The contracts doc lists invariants that **are** guarded. There was no list of decisions settled but
**not enforceable** — which is precisely the set that gets re-opened.

---

## Measured evidence

`scripts/diff-seed-vs-db.cjs` (built today), **before** any fix:

```
seed     : 47 protocols, 419 placements
database : 45 protocols, 449 placements
ORPHAN   : 30 rows — live config the seed no longer contains
```

**`rsi-overbought` = 28 of the 30.**

- declares `directionBias: 'bearish'`, `maxScore: 140`
- the seed places it in **2** protocols (`vix-short-v1`, `mt5-technical-short`) — both short-side, correct
- the database still had it in **30**, of which **28 are `LONG_ONLY`**

In a `LONG_ONLY` protocol a bearish directive is excluded from **both numerator and denominator**,
so it does **not** read as a zero — it silently lowers the **reachable ceiling** by 140 points.
28 × 140 = **3,920 stranded points**. That is **#792**, and these orphans were its mechanism.

`scripts/detect-circular-work.cjs` (built today), across 7 watched areas — **every one shows both
OPEN and CLOSED issues:**

| Area | Open | Closed | Gap |
|---|---|---|---|
| `stale-data` | 7 | 6 | #750/#751/#780/#783 all within one week |
| `seed-db-drift` | 6 | 8 | #789 vs earlier seed work |
| `duplicate-directive` | 3 | 7 | — |
| `denominator` | 3 | — | #758 fixed **twice** |
| `capacity-threshold` | 1 | 3 | #638 → #761, 26 days |
| `direction-mismatch` | 2 | 1 | #620 |
| `gate-vs-score` | 1 | 2 | **#638 → #789/#790, 26 days** |

---

## What was built

| Artefact | Purpose | Exit behaviour |
|---|---|---|
| `scripts/detect-circular-work.cjs` | Flags re-opened areas: closed issues, open issues, handoffs, commits per topic | Advisory only (**0** always) |
| `scripts/diff-seed-vs-db.cjs` | Compares seed placements to DB placements; classifies ORPHAN / MISSING / MOVED / KIND-CHANGED | **1** on drift |
| `docs/SETTLED-DECISIONS.md` | **The register** — 10 settled decisions with guard status | — |
| `.github/instructions/anti-circular-work.instructions.md` | Agent-facing rules (applies to `nest/src/**`, `src/**`, `scripts/**`, `docs/**`) | — |
| `nest/prisma/reconcile-rsi-overbought-792.sql` | The SQL that removed the 28 stale rows | — |
| npm scripts `audit:circular-work`, `audit:seed-drift` | Convenience wrappers | — |

### Why `detect-circular-work` is advisory, not a build gate

It reads **history**, which is not a correctness property. A gate on history would fire on healthy
code and get switched off — the exact failure the contracts doc warns about, and which I hit myself
today (see below). `diff-seed-vs-db` **can** be gated because drift is a real inconsistency.

---

## ⚠️ A bug I made in my own detector, worth recording

`diff-seed-vs-db.cjs` first reported **423 differences** on healthy data, including **419 phantom
"MOVED" rows.** Cause: `protocol_directive_group` has **two** identifiers —

| Column | Type | What it is |
|---|---|---|
| `id` | `varchar(36)` | the row's **UUID** — what `protocol_directive_entry.groupId` points at |
| `groupId` | `varchar(50)` | the **NAME** — `"technical"` / `"risk"` — what the **seed** uses |

I joined on the right column to resolve the group, then **reported the wrong one as the key**. The
seed keys by name, so every comparison mismatched.

**This is the same failure mode as the INV-GATE-MEMBERSHIP rule being too broad earlier today: a
detector that cries wolf on healthy data gets ignored, which is worse than no detector because it
looks like coverage.** Caught by running it against the real tree instead of trusting it.

---

## Verification (2026-09-11)

| Check | Result |
|---|---|
| `diff-seed-vs-db.cjs` placements | **419 seed = 419 DB** ✅ |
| Remaining drift | 2 items, **protocol-level, owner decision required** (below) |
| `rsi-overbought` rows | 30 → **2**, both `SHORT_ONLY` ✅ |
| `validate-directive-group-kind.cjs` | ✅ OK — 47 protocols, 70 gate placements |
| `validate-pipeline-contracts.cjs` | ✅ 22 invariants, wiring + QA mirror satisfied |
| `node --check` on both new scripts | exit 0 |
| Boot `ProtocolHealthService` | 16 issues / 14 protocols, **0 duplicate warnings** |

---

## 🛑 Two items needing YOUR decision (not fixed by me)

| Item | Detail | Why I stopped |
|---|---|---|
| **`060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d`** | a protocol row whose **slug is a UUID**, with **0 groups** | Looks like junk, but deleting a protocol row is not a drift fix — it's a data decision |
| **`signals-workbench`** | a real protocol present in the DB but **absent from the seed** | Either it should be seeded (so a rebuild recreates it) or it is intentionally DB-only. I do not know which |

Both are reported by `diff-seed-vs-db.cjs` on every run until decided.

---

## What this means going forward

The tools only help if they are **used**. The concrete change:

1. **Before changing a listed area** → `node scripts/detect-circular-work.cjs <topic>`
2. **After ANY seed edit** → `node scripts/diff-seed-vs-db.cjs`
3. **When closing an issue in a settled area** → add a **guard**, or mark the row 🔴 UNGUARDED in
   `docs/SETTLED-DECISIONS.md`. An unguarded decision **will** be re-opened.
4. **Date every "why" comment** — an undated rationale is indistinguishable from a stale one.

### The two 🔴 rows most likely to loop again

- **Row 9** — the `directionBias` capacity test. **Already tried and reverted once** (2026-09-10)
  after measurement showed declared bias massively understates what directives emit
  (`macd-crossover` declares `neutral`, fired directionally 5,252 times). Guaranteed to be
  re-proposed unless the reasoning is visible.
- **Row 10** — classification thresholds. Bands were invalidated by the #758 denominator change.
  Recalibrating **before** the denominator is frozen is the loop itself.

---

## Related

- **#638** — the 2026-08-16 decision that did not stick (source of the 26-day loop)
- **#789 / #790** — the same class rediscovered
- **#791 / #792** — the seed/DB drift and the 3,920 stranded points it hid
- **#761** — thresholds; explicitly **not settled**
- `docs/SETTLED-DECISIONS.md` — the register
