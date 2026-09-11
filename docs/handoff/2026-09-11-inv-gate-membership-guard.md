# Handoff — INV-GATE-MEMBERSHIP: build-time guard for directional voters in risk gates

**Date:** 2026-09-11
**Issue:** #789 (follow-up guard)
**Type:** Guard / contract addition + 4 real defects fixed

---

## What changed

| Layer | Change |
|---|---|
| **New guard** | `nest/scripts/validate-directive-group-kind.cjs` — fails the build when a non-`structural` directive sits in an `isRiskGate: true` group |
| **New test** | `nest/scripts/test-gate-membership-guard.cjs` — 7 assertions; proves the guard bites *and* stays quiet on correct code |
| **Wired** | Added to `prebuild` (after `validate-protocol-directions.cjs`, before `validate-pipeline-contracts.cjs`); npm scripts `audit:gate-membership`, `audit:gate-membership:test` |
| **New invariant** | `INV-GATE-MEMBERSHIP` row in the contracts doc + `SCAN_ENFORCED` entry + `qa-contract-022` QA entry |
| **4 real defects fixed** | `btc-halving-cycle`, `crypto-weekend-effect` (×2), `earnings-momentum` moved out of risk gates into scoring groups |
| **DB reconciled** | `nest/prisma/reconcile-gate-membership-789.sql` — the seeder cannot move a placement, so explicit SQL was required |

**Verified:** guard passes (0 violations, 70 gate placements); guard test 7/7; `tsc --noEmit` exit 0; `build:api` succeeded with the guard in the chain; DB reports **0 voters in gates**; boot health 16 issues / 14 protocols with **0 duplicate warnings**.

---

## The theory — two kinds of group, and why placement is semantic

A protocol is an assembly of groups. The two kinds are **not interchangeable buckets that both feed the same sum** — they answer different questions:

- **SCORING group** (`isRiskGate: false`) — *"which way, and how strongly?"* Its directives feed the directional composite and their `maxScore` values form the denominator.
- **RISK GATE** (`isRiskGate: true`) — *"should this be trusted at all?"* It does not vote on direction; it scales what the scoring groups produced.

`protocol-gating.service.ts` enforces the separation structurally — `inSignal = !isGateGroup && …` (L689), no `capacityMax` contribution (L749), no bullish/bearish accumulation (L763/766).

**The consequence is counter-intuitive and is the whole reason this guard exists: a directional predictor in a risk gate is not downgraded, it is ERASED.** It still runs. It still consumes its bars. It still produces a confident `bullish`/`bearish` reading. The scorer throws the reading away — no score, no direction, no capacity. Nothing errors, and nothing reports it. The only symptom is a number that reads slightly too low.

That is the "plausible numbers, no error" class the contracts doc exists to catch.

---

## Why a scan of seed data, and not a canary

Every other invariants row is enforced either by a **canary** (does the canonical mechanism still exist?) or a **scan** (is a banned pattern absent?). Neither fits here.

The fault is a property of a **data file's structure** — which directive id sits in which group — not of any single function. A canary would verify that `protocol-gating.service.ts` still contains `!isGateGroup`, which it always will; the file is not what breaks. This is the same blind spot that let ~27,376 phantom bars sit undetected in #783: the bar invariants all verified a *helper exists* and could not see that the *rows were wrong*.

So the guard reads the actual seed, reads the actual directive classes for their `category`, and compares them. It also **fails if it parses zero protocols** — a parser that silently finds nothing must not report a pass, because that would disable every membership check while showing green.

---

## ⚠️ The mistake I made — the rule was too broad, and testing caught it

My first rule required `category === 'risk'`. It reported **68 violations**.

**62 of them were correct code.** A breakdown by category:

```
39  structural|liquidity-check        6  structural|budget-gate
 5  structural|position-size-kelly    5  structural|rollover-risk
 3  structural|market-regime          2  pattern|crypto-weekend-effect
 2  structural|dxy-regime             1  pattern|btc-halving-cycle
 1  ratio|earnings-momentum           ...
```

The codebase's own interface had the answer the whole time — `directives/interfaces/directive.interface.ts` L230:

```
* - 'structural': Risk gates, regime checks. Modifier, not signal score.
```

**`'structural'` IS the gate marker.** I invented `'risk'` as a category name without checking, and it does not exist. Narrowing to `structural` took the report from 68 → **4**, all 4 genuine — and 70 gate placements now pass silently.

This is precisely the failure mode the contracts doc warns about: *"a guard that emits warnings gets ignored, which is worse than no guard because it looks like coverage."* A 68-violation guard on a healthy tree would have been disabled within a day.

**Engineering principle: read the codebase's own vocabulary before inventing a rule.** The correct definition was already written down; guessing cost one full iteration.

**The regression test for it is `structural-in-risk-gate-is-correct`** in the test file — if someone narrows `GATE_CATEGORIES` back, that assertion fails first. It also asserts the guard still *passes* on the real seed, so an over-tightening is caught before it reaches the build.

---

## The 4 real defects the guard found

All four are **`0 scoring / N risk`** — unlike `session-open-effect`, which had a lower-`sortOrder` scoring copy that happened to save it, **these were entirely dead**. Removing them would have deleted the directive from the protocol; the correct fix was to **move** each into a scoring group.

| Directive | Category | maxScore | Was | Now |
|---|---|---|---|---|
| `btc-halving-cycle` | `pattern` | **200** | `btc-speed-v1` risk | `btc-speed-v1` sentiment |
| `crypto-weekend-effect` | `pattern` | 50 | `btc-speed-v1` risk | `btc-speed-v1` sentiment |
| `crypto-weekend-effect` | `pattern` | 50 | `btc-scalp-v1` risk | `btc-scalp-v1` sentiment |
| `earnings-momentum` | `ratio` | 100 | `momentum-stock-v1` risk | `momentum-stock-v1` sentiment |

**`btc-halving-cycle` carries the highest `maxScore` in the system (200) and was contributing nothing** in the protocol built around it. `earnings-momentum` declares `directionBias: 'bullish'` — an unambiguous directional voter sitting in a gate.

Group choice: all four are macro/calendar/fundamental catalysts rather than price-action signals, so `sentiment` is the right scoring group. Placement is a judgement call a reviewer should sanity-check; the guard only proves the *kind* is now correct.

**Side finding:** moving `earnings-momentum` revealed it went from 1 → 2 scoring placements, so it had a latent duplicate elsewhere too. The move resolved that as well.

---

## Verification evidence

| Check | Result |
|---|---|
| `validate-directive-group-kind.cjs` | ✅ OK — 47 protocols, 134 groups, 44 risk gates, **70 gate placements**, 0 violations |
| `test-gate-membership-guard.cjs` | ✅ 7/7 — rejects the defect, names the site, accepts `structural` gates, refuses to pass on an empty parse |
| `validate-pipeline-contracts.cjs` | ✅ 22 invariants (was 21), wiring satisfied, QA mirror satisfied |
| `tsc -p tsconfig.build.json --noEmit` | exit 0 |
| `nest run build:api` | **Build succeeded** with the guard in the `prebuild` chain |
| DB: voters remaining in gates | **0** |
| DB: which group each now sits in | 4 rows, all `is_risk_gate = 0` |
| Boot `ProtocolHealthService` | 16 issues / 14 protocols, **0 duplicate warnings** |

---

## ⚠️ Why the DB needed explicit SQL (again)

`ProtocolDbService.seedProtocolsToDatabase()` is **upsert-only** — it creates and updates but never deletes. So editing the seed does not move a placement; re-seeding alone left the obsolete risk rows in place. Same trap documented for #789.

The reconciliation file is idempotent and runs SELECT → DELETE → three verification SELECTs. It also documents a fresh gotcha: **`sortOrder` lives on the group table, not the entry table** (`protocol_directive_entry` is `id, groupId, directiveId, maxScore, active`).

---

## Follow-ups worth raising separately

1. **⚠️ 6 placements are UNVERIFIED, not verified-clean — filed as #790.** `sp500-regime` (×2), `spy-qqq-relative-strength` (×3) and `vix-strategy` (×1) sit in risk gates and **all three emit `bullish`/`bearish`**, so their readings are currently discarded. They declare **no `category`**, which is optional on `IDirective`, so the guard cannot enforce them and reports them as `⚠ no category — NOT CHECKED` on every build. The open question is a design one: set `category = 'structural'` if they are genuinely regime gates, or move them to a scoring group if they are voters. Today the code says "gate" (placement) while the directive says "voter" (returns a direction) — accidental either way.
2. **A false negative I found and fixed in the guard itself.** The first resolver only looked for `implementations/<id>.directive.ts` (one class per file), so it reported those three as *"no directive class found"* and skipped them — printing **green while 6 placements went unchecked.** The repo has a second shape: `momentum-and-macro.directives.ts` holds many classes. The resolver now handles both, slicing from `readonly id = …` to the next `export class` so fields cannot leak between classes. **"Unclassified" and "verified clean" are not the same output** — bucketing unreadable inputs into silence reports green for the wrong reason.
3. **The `maxScore` on gate entries is ignored.** `protocol_directive_entry.maxScore` exists (default 100) but the gating service reads `maxScores.get(directiveId)` from the directive class, so a gate's stored `maxScore` is dead config.
4. **#761's real question is still open** — whether capacity includes points the numerator cannot reach. The gating service's own comment (L721+) records that a `directionBias`-based fix was tried and reverted because it excludes the directives doing most of the real work. That must be driven by `scripts/analyse-unreachable-capacity.cjs`, not by declarations.

---

## Related

- **#789** — the `session-open-effect` instance that motivated this guard
- **#783** — the bar-alignment incident that established "verify the data, not just the helper"
- **#761** — unreachable capacity (ADR-011)
- **ADR-014** — one implementation per concept
