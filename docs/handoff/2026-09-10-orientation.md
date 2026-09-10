# Orient a single agent on the scoring-layer findings from 2026-09-10

**Purpose:** this is a **starting point for one agent**, not a work order. It records what a
long session established about the scoring layer, what is already fixed, what is suspected,
and *why* each thing matters — so the next agent does not re-derive it or, worse, re-break it.

Read this first, then work the linked issues. **Nothing here should be acted on without
reading the linked issue** — several items look like easy fixes and are not.

---

## Read in this order

| Order | What | Why this order |
|---|---|---|
| 1 | **#761** — thresholds unreachable on the corrected denominator | Blocks everything else. Until the bands are right, no other tuning can be trusted |
| 2 | **#758** — the denominator (reopened, partly fixed) | The foundation. Its history explains why percentages read low |
| 3 | **#725** — smart adaptive gate ⚠️ **has a conflict** | Read the comment I posted; it contradicts the shipped Adaptive Target |
| 4 | **#769** — schema drift 🛑 | Read before touching *any* database schema |
| 5 | **#760** — protocols that never produced a signal | The "is scoring working?" question, with measured evidence |
| 6 | **#766** — directives fabricating scores | Explains why some protocols read high on nothing |

---

## The one-paragraph version of what happened

The scoring layer had **two different denominators in use at once**. The percentage shown
on a card divided by the protocol's *configured capacity* (910 points for `xau-speed-1h`),
while the `BUY`/`STRONG_BUY` label and the pre-trade gate divided by the *observed* sum of
whichever directives happened to fire (185). So one reading produced **17% on the card and
82% for the label** — both arithmetically correct, answering different questions. #758 fixed
the persisted number and left the label behind; v0.6.6 finished it. Completing it exposed
that the 80/40 thresholds were only ever "working" because the observed denominator inflated
the number — on the corrected scale the **maximum ever recorded is 32%**, so `STRONG_BUY` is
currently unreachable (#761).

---

## ✅ Fixed this session — do not revert

| What | Detail |
|---|---|
| **One denominator for label + display + gate** | `signalPct`, `signalMax` and `meta.maxScore` all use `configuredSignalMax`. `signalRaw / signalMax === signalPct` is now an identity. Invariant `INV-STABLE-DENOMINATOR` |
| **One authoritative Score row per run** | Two writers were both `create`ing a row per tick; the thin one was newer and won. `collapseDuplicateWrites()` + `persistScores()` now adopts. Invariant `INV-ONE-ROW-PER-RUN` |
| **Ladder cards are uniform** | Same slots on every card, one state chip from a fixed vocabulary, live-actionable ranks above frozen |
| **Adaptive Target** (off by default) | `adaptive-target.ts` + registry toggle + Ladder `TARGET` badge. ⚠️ See the #725 conflict |
| **Schema guard** | `npm run db:check`; `db push` blocked. See #769 |

**Verified invariants are listed in one place:** `.github/instructions/meta-stack-contracts.instructions.md`
(`INV-*`), machine-checked by `nest/scripts/validate-pipeline-contracts.cjs` in `prebuild`.
Each was a real bug with hard evidence and has already been "simplified away" once by someone
who did not know it was load-bearing. If something there looks redundant, it is not.

---

## 🛑 Traps — each one has bitten already

1. **Never run `prisma db push`.** It drops 10 raw-managed tables including
   `strategy_signal_queue` — the trade execution queue. It does **not** error; it warns and
   waits for a `y`. `npm run db:check` first. (#769)
2. **Do not "fix" a low percentage by raising the score.** The low number is usually honest.
   `PROTOCOL-THEORY.md` documents that a protocol's ceiling is *by design* far below its
   configured capacity, because directives are mutually exclusive — `rsi-oversold` and
   `rsi-overbought` cannot both peak. Low is not the same as broken.
3. **A ceiling must not be able to fall.** A target that adapts downward hides a directive
   that stopped working: the bar lowers to match and the signal still reads healthy. That
   failure class (*plausible numbers, no error*) is what most of the `INV-*` list exists for.
   This is exactly where #725's locked decision conflicts — see its comment.
4. **`prisma generate` fails with `EPERM` while the API runs** (it locks the query-engine
   DLL). Stop the API before `npm run build`. A failed `prebuild` leaves `dist/` empty after
   `rimraf`, and the API then won't start.
5. **`$PID` is a reserved PowerShell variable.** `foreach ($pid in ...)` throws. Use another
   name — this cost a cycle.
6. **`score.timestamp` is UTC; process/locals are BST.** Comparing them without converting
   makes fresh rows look stale.
7. **The contract gate can be failing on someone else's in-flight work.** Attribute before
   "fixing" — a `tsc --noEmit` distinguishes your breakage from theirs.

---

## Where the evidence lives

| Source | Contains |
|---|---|
| `docs/handoff/2026-09-10-unified-denominator.md` | The two-denominator investigation, full arithmetic |
| `docs/handoff/2026-09-10-ladder-card-uniformity.md` | The duplicate-write bug and ranking inversion |
| `docs/handoff/2026-09-10-adaptive-target.md` | The ceiling mechanism and why it is monotonic |
| `docs/schema-drift-control.md` | The 10 unmodelled tables and the controls |
| `docs/scoring-architecture.md` | **Canonical** dual-score model + the denominator rule |
| `PROTOCOL-THEORY.md` (GDrive) | Per-protocol intended ceilings — read before judging a low score |
| `.agent-rules.md` (GDrive) | Includes the 🛑 database section |

---

## Honest gaps — unknown, not "fine"

- **Is 32% the real maximum, or an artefact of the old denominator?** The distribution was
  measured before the fix. #761 should re-measure.
- **`xau-speed-v1` has never produced a run of its own** — it only renders by borrowing from
  `xau-speed-4h`. Whether that is intended is unresolved; #760 holds the measured numbers.
- **Column-level schema drift** — `trade.pnlRaw`, `trade.exitPriceRaw`, `symbol_route.provider`
  and others exist in the DB but not `schema.prisma`. Same trap as the table-level drift, one
  level down. In #769.
- **No migration history at all**, so drift cannot be *detected*, only *guarded*. #769.
