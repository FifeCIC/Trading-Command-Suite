# Handoff — #790 resolved: gate-vs-voter decided per directive, and the "UNVERIFIED" warning is gone

**Date:** 2026-09-11
**Issue:** **#790 — CLOSED**
**Type:** Directive classification + placement fix + tool-wording correction

---

## What changed

The guard reported **6 placements it could not check** on every build:

```
[gate-membership] ⚠ declare no `category` — NOT CHECKED, verify these are genuine gates:
                    sp500-regime (2), spy-qqq-relative-strength (3), vix-strategy (1)
```

That warning **looked like coverage but was not.** `category` is optional on `IDirective`, so the
guard could classify nothing and skipped them. It now reports:

```
[gate-membership] ✅ OK — every risk-gate member is a declared gate
                    (67 gate placements, ALL verified)
```

| Directive | Action taken |
|---|---|
| `spy-qqq-relative-strength` | **Moved** out of 3 risk gates → scoring groups (`sentiment` ×2, `bearish-sentiment` ×1) |
| `sp500-regime` | **Kept** in its 2 gates; declared `category = 'structural'` |
| `vix-strategy` | **Kept** in its 1 gate; declared `category = 'structural'` |

---

## The theory — how each was decided

`protocol-gating.service.ts` excludes `isRiskGate` groups from the signal entirely (L689 `inSignal`,
L749 no `capacityMax`, L763/766 no bullish/bearish accumulation). So there are exactly two correct
outcomes for a directive found in a risk gate:

- it is a **voter** that belongs in a scoring group (moving it *restores* a lost signal), or
- it is a **gate** and its `category` should say so (a declared structural gate contributes as a
  **multiplier**, which is the design).

**Guessing from the name is not enough — the deciding evidence is what the directive optimises for.**

### `spy-qqq-relative-strength` → VOTER

Returns `'bullish' | 'bearish' | 'neutral'` from momentum acceleration. A **symmetric** directional
signal: being in a gate excluded it from **both numerator and denominator**, so it did not read as a
zero — it silently lowered the reachable ceiling. Same class as #792's `rsi-overbought`.

**Side benefit:** moving it into `dxy-sensitivity-v1`'s `sentiment` group also **filled a pre-existing
empty group** (weight `0.2`, contributing nothing). Two faults, one move.

### `sp500-regime` → GATE

It **does** return a direction (SMA200 deviation + slope), which is what made it ambiguous. But the
seed documents the placement as deliberate:

> `vix-short-v1` description: *"Risk gate (SP500 regime) is **mandatory**."*

So the placement was intended and only the **declaration** was missing. ⚠️ The in-code comment notes
that a gate *may* emit a direction — it expresses the direction it is gating *for*; `structural` is
what tells the scorer to treat it as a hurdle.

### `vix-strategy` → GATE (and this is the one worth reading)

Three signals together, none sufficient alone:

1. Description: *"ATR percentile as VIX proxy for **position sizing**."* A size decision is a hurdle.
2. It returns `bullish` or `neutral` and **never `bearish`** — it cannot express a short view.
3. **Its score RISES with volatility** (`percentile > 85` → `+30`, *"extreme vol (VIX spike proxy)"*).

**Point 3 is decisive.** If this were treated as conviction, a high volatility score would *increase*
BUY strength — the exact opposite of the intent. A high score here means "dangerous conditions,
reduce size."

⚠️ **The in-code comment carries an explicit "do NOT fix this by moving it"** — because point 2 alone
makes it look like a weak voter, and a future reader would plausibly move it into a scoring group and
invert its meaning.

---

## ⚠️ Gate 3 caught the drift this change itself created

Moving a directive is **precisely** what the upsert-only seeder cannot do. Straight after the edit,
`diff-seed-vs-db.cjs` reported:

```
drift: 3 difference(s) — KIND-CHANGED 3
  ⚠️ the gate/scoring kind differs, so whether it SCORES AT ALL differs. Highest-risk drift.
   · dxy-sensitivity-v1  :: spy-qqq-relative-strength   seed scoring [sentiment] vs db GATE [risk]
   · forex-session-v1    :: spy-qqq-relative-strength   seed scoring [sentiment] vs db GATE [risk]
   · mt5-technical-short :: spy-qqq-relative-strength   seed scoring [bearish-sentiment] vs db GATE [short-risk]
```

**Why this mattered more than a count mismatch:** without reconciliation the directive would have
existed in **both** a scoring group and a gate. The scorer's `seenDirectiveIds` dedupe picks whichever
comes first — so the fix would have appeared **not to work**, with no error. That is the #789 duplicate
trap, caught this time before it could mislead.

**Also learned:** the re-seed initially appeared to succeed but wrote nothing, because the API serves
the **compiled** seed from `dist/`. **Rebuild before re-seeding.** (`entries: 419` was unchanged both
before and after, which is exactly the "diagnostic lies" pattern.)

Reconciled via `nest/prisma/reconcile-gate-membership-790.sql` (SELECT → DELETE → 3 verifications).

---

## ⚠️ A tool defect fixed in passing

`find-risk-group-directives.cjs` printed, unconditionally for any risk-gate placement:

```
❌ in a RISK group (isRiskGate: true) : N   <-- inert, contributes nothing
RISK-GROUP OCCURRENCES (the defect):
```

**Both lines are wrong for a declared structural gate**, which contributes as a multiplier. An analysis
tool that labels a correct configuration *"the defect"* sends the next agent to break it — the same
"cries wolf" failure as a guard that fires on healthy code. Both now state the two cases rather than
asserting one.

---

## Verification (2026-09-11)

| Check | Result |
|---|---|
| `validate-directive-group-kind.cjs` | ✅ OK — **67 gate placements, all verified**, zero `⚠ NOT CHECKED` |
| `spy-qqq-relative-strength` placement | **4/4 scoring groups** (was 1/4 — three dead) |
| `sp500-regime` / `vix-strategy` | 3 placements remain in gates, now **declared** |
| `diff-seed-vs-db.cjs` | **`drift: 0`** — 47 protocols, 419 placements both sides |
| `contract-probe.cjs` | **12 passed, 0 failed, 0 skipped** |
| `validate-pipeline-contracts.cjs` | 23 invariants, wiring + QA mirror satisfied |
| `tsc --noEmit` | exit 0 |
| `build:api` | **Build succeeded** |

---

## Related

- **#789 / #792** — the same class: a directive in the wrong group kind losing signal silently
- **#761 / #779** — whether a bearish directive should be able to act as a *veto* in `LONG_ONLY`
  protocols. **Not decided here** — a directive cannot be both a gate and a voter
- **#796** — the standing work (enforcement of the register + Phase 4 input/output tests)
