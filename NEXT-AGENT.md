# Next Agent — scoring-layer orientation

**Status:** ⚠️ **HISTORICAL. The work order below is from 2026-09-16 and has NOT been re-measured.**
**Last verified:** 2026-09-16 · **Version then:** 0.15.0 · **Version at 2026-10-12:** 0.128.0
**Stack:** Vite 5173 · NestJS 3201 · MT5 5000/5001

> 🛑 **Read this before acting on the queue below.** Measured **2026-10-12**: this file's "work in this
> order" list runs **#758–#782**, while live issue numbers are **#1107–#1113** — the ordering is roughly
> four months of work out of date. It is kept because its explanations are still the best short account
> of the *scoring-layer traps*, not because the queue is current.
>
> **Where the current answers live:** live ordering → **`.github/PRIMARY-GOALS.md`**; what is waiting on
> a human → **`.github/REVIEW-QUEUE.md`**; open work → the tracker. If you update this file, re-measure —
> do not increment a number by hand.

A long session on the scoring layer finished in September 2026. The sections below record **what was
wrong, what was fixed, and which traps to avoid** — so you do not re-derive it or re-break it.

---

## 🛑 Read these two before touching anything

| | |
|---|---|
| **`.github/instructions/database-schema.instructions.md`** | `prisma db push` **drops every unmodelled table** here (**13** at present, 4 live + 9 backup), including the trade execution queue. It does **not** error. (#769) |
| **`.github/instructions/meta-stack-contracts.instructions.md`** | The `INV-*` invariants. Each was a real bug with hard evidence, each has already been "simplified away" once by someone who did not know it was load-bearing. If one looks redundant, it is not. |

---

## ⚠️ Work order — HISTORICAL (2026-09-16), NOT the current queue

**Do not follow this as a queue.** It is preserved because the *reasons* it gives for each step are
still useful. For what to work on now see `.github/PRIMARY-GOALS.md` and the tracker.

**#776 was the tracking issue at the time** — it holds the sequencing, the shared measurement step, and
the acceptance criteria as they stood then. The table below is the short form:

| # | Issue | Why this order |
|---|---|---|
| 1 | **#761** — thresholds unreachable on the corrected denominator | **Blocks the rest.** Until the bands are right, no other scoring tuning can be trusted |
| 2 | **#758** — the denominator | The foundation; its reopen comment explains why percentages read low |
| 3 | **#725** — smart adaptive gate ⚠️ | **Has a conflict** with what shipped. Read the comment before acting |
| 4 | **#769** — schema drift 🛑 | Before any schema work |
| 5 | **#760** — protocols that never produced a signal | "Is scoring working?", with measured evidence |
| 6 | **#766** — directives fabricating scores | Why some protocols read high on nothing |
| 7 | **#774** / **#775** | Two smaller classification/label defects found last session |
| 8 | **#782** — Ladder "No active protocols" + selection loss | ⚠️ **UI-layer instance of the same failure class as the `INV-*` list**: a failed fetch is swallowed into a plausible empty state, and then the saved selection is *destroyed* by a prune effect with no loaded-guard. 18 swallowed `catch()` sites. Read before touching any `queryFn` |

Fuller context: **`…\Trading-Command-Suite-Documentation\handoff\2026-09-10-orientation.md`** — includes the one-paragraph
explanation of what was wrong, what is fixed, and the traps.

---

## The shortest version of what was wrong

The scoring layer used **two denominators at once**. Cards divided by the protocol's configured
capacity (910); the `BUY`/`STRONG_BUY` label and the gate divided by the observed sum of
directives that happened to fire (185). One reading produced **17% on the card and 82% for the
label** — both correct, answering different questions.

v0.6.6 unified them. That exposed the follow-on: the `80`/`40` thresholds were only ever
"working" because the inflated denominator flattered the number. On the corrected scale
**nothing recorded reaches 40**, so `STRONG_BUY` is unreachable and the gate is ~5× stricter
than intended. **That is #761, and it is the thing to fix first.**

---

## ✅ Do not revert — fixed last session

- **One denominator** for label + display + gate (`INV-STABLE-DENOMINATOR`)
- **One Score row per run** — two writers were both creating one; the thin one won
  (`INV-ONE-ROW-PER-RUN`)
- **Ladder cards uniform** — same slots, one state chip, live ranks above frozen
- **Adaptive Target** — off by default, monotonic (peak only rises). ⚠️ Conflicts with #725
- **Schema guard** — `npm run db:check`; `db push` blocked

---

## ⚠️ Try not to

| | Why |
|---|---|
| **Raise a score to fix a low percentage** | The low number is usually honest. Ceilings are *by design* below configured capacity — `PROTOCOL-THEORY.md`: `rsi-oversold` and `rsi-overbought` cannot both peak. Low ≠ broken |
| **Make a ceiling able to fall** | It hides a directive that stopped working: the bar lowers to match, the signal still reads healthy. That *plausible-numbers-no-error* class is what most of the `INV-*` list exists for. This is the live conflict in #725 |
| **Run `npm run build` with the API up** | `prisma generate` fails `EPERM` (it locks the query-engine DLL), leaving `dist/` empty after `rimraf` so the API then won't start |
| **Assume a RED contract gate is yours** | `tsc --noEmit` distinguishes your breakage from another agent's in-flight work |
| **Trust a doc over the code** | #775 exists because a doc and the code describe *different* expressions for the same thing |
| **Swallow an API error into an empty array** | 18 sites do this (`.catch(() => ({ protocols: [] }))`). It makes a failure look like real data, defeats react-query's retry, and in the Ladder it *destroys the user's saved selection*. #782 |

---

## Quick reference

```powershell
# Stack (all 3 services)
pwsh -File scripts\tcs-launch.ps1
pwsh -File scripts\tcs-stop.ps1          # ⚠️ stops ALL THREE, not one

# Schema safety — before ANY schema change
npm --prefix nest run db:check

# Build (API must be STOPPED)
npm --prefix nest run build              # backend: prebuild runs prisma generate + contract gate
npm run build                            # frontend (Vite)

# Contract gate on its own
node nest\scripts\validate-pipeline-contracts.cjs
```

**Gotchas that cost time last session:** `$PID` is reserved in PowerShell (use another name);
`score.timestamp` is **UTC** while process times are **BST**; MySQL needs `$env:MYSQL_PWD` or
the stderr warning swallows output.

---

## Where the evidence lives

| Source | Contains |
|---|---|
| `docs/scoring-architecture.md` | **Canonical** dual-score model + the denominator rule |
| `…\Trading-Command-Suite-Documentation\handoff\2026-09-10-unified-denominator.md` | The two-denominator investigation |
| `…\Trading-Command-Suite-Documentation\handoff\2026-09-10-ladder-card-uniformity.md` | The duplicate-write bug + ranking inversion |
| `…\Trading-Command-Suite-Documentation\handoff\2026-09-10-adaptive-target.md` | The ceiling mechanism, and why it is monotonic |
| `docs/schema-drift-control.md` | The 10 unmodelled tables and the controls |
| `docs/theories/PROTOCOL-THEORY.md` (central store) | Per-protocol **intended** ceilings — read before judging a low score |
