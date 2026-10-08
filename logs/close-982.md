# #982 — the bot session slot is DECLARED — CLOSE (2026-10-08)

## Pre-close checklist — evidence per acceptance criterion

**1. No bot can pass the build with an unfilled session slot — canaried** — ✅

`strategy-seed-session-declared.spec.ts` (NEW, in the `prebuild` jest list). Canary, observed
2026-10-08: one seed entry set back to `sessionWindow: null` →

```
+ "Sydney AUDJPY Session: unfilled — null"
Tests: 1 failed, 2 passed, 3 total        ← the gate fails AND names the bot
```

⚠️ **Measured while canarying, and worth stating: `typecheck` stayed GREEN.** This project compiles
with `strictNullChecks` off, so the declared type documents the contract but does not enforce it —
**the spec is the effective gate**. Restore → 3/3 green.

**2. A deliberate all-hours bot is expressible and distinctly readable** — ✅

`'all-hours'` (synonym `'bypass'`) → `sessionSlotKind()` returns `all-hours`, live on the audit:

```json
{ "name": "Gold Swing 1H", "slotKind": "all-hours", "declared": true, "gated": false,
  "reason": "all-hours (declared bypass) — no clock is enforced" }
```

vs an unfilled row: `slotKind: "unfilled"`, `declared: false`, `reason: "undecided — the session
slot was never filled (NULL)…"`. Spec pins all five readings distinct (unfilled ≠ all-hours ≠
unreadable ≠ open ≠ shut). **Gate behaviour is identical for every no-tag form — verified live**
(the same bots stayed `gated:false` throughout the migration).

**3. Every previously-NULL bot classified, with the recorded reason** — ✅

**19 rows were NULL** (18 active + 1 inactive; 15 seeded + 4 `(copy)`).
**Classification: `all-hours` — the behaviour-preserving choice, for ALL 19**, because the
clock-vs-news question is the OWNER's call (`session-window.ts`/ #759: *"report the question; do not
answer it by editing the bot's trading hours"*) — inferring windows for the NULL twins would have
changed gating on a guess about what a NAME meant. Recorded in **register row 70** and on this
issue. The twin disagreement (USDJPY `asian` vs EURJPY, etc.) stays OPEN as that owner call.

**4. The bot view shows a filled value for every bot** — ✅ (verified, do not rebuild — and it
needed a fix to be verifiable)

Browser, `/trading/strategy/6ebd9aae-…` (`Sydney AUDJPY Session`): the row renders

```
Session window | sessionWindow | all-hours | LIVE
```

⚠️ Verifying this **found and fixed #1092** — the page crashed on *every* bot (brake-layer nodes
have `tally: null` by design; the stage filter read `.declared` unguarded). Fixed (one line, + the
consumer sweep showing it was the only unguarded read), canaried in the browser (crash → render),
frontend build green. Note the page also displays the updated rule text, proving the new registry
copy is live.

**5. Existing session behaviour unchanged for a declaring bot — before/after** — ✅

| bot | before (12:29Z, #981 build) | after (12:45Z+, #982 build) |
|---|---|---|
| `US SPY Speed` | `gated:true | outside US session (open: London)` | **identical** |
| `London EURGBP Session` | `gated:false | within window (london)` | **identical** |

DB check across the migration: tagged rows **21 → 21** (the UPDATE touched only NULLs); totals
19 all-hours + 21 tagged = 40 = every bot.

**6. Gate 3 — db:check clean, schema.prisma in the same change, NULL counts before/after** — ✅

- `npm --prefix nest run db:check` → **✅ OK** (it first caught **another agent's**
  `trade_repair_1080_backup` — declared, not dropped, following the established pattern).
- `schema.prisma` sessionWindow column comment updated in this change (documents NULL = UNFILLED,
  `'all-hours'` = declared, enforcement pointer).
- **NULL count: 19 total / 18 active → 0 / 0.** Migration path: the convergent seeder
  `POST /api/trading/strategies/seed` (dry-run first: 15 changes; applied: 15 updated, 0 created),
  then a direct UPDATE for the 4 `(copy)` bots that have no seed entry — that gap is stated below.

## Gate summary

- **Structural**: typecheck clean; `build:api` full prebuild green (incl. the new gate); Vite build green.
- **Contract**: prebuild validators green; `validate-decisions.cjs` — 70 rows, all with guard status.
- **State**: counts above; audit payload verified live; bot view verified in the browser.
- **Behaviour**: gate outcomes before/after identical for declaring bots; all-hours bots `gated:false` before and after.

## Deferred / Deliberately unchanged

- **Deferred — the twin clock-vs-news decision**: which of each city pair is right is the owner's
  call (#759 rule). Owner: tracks on #982's register row 70 (🟡 PARTIAL — live NULLs via the update
  DTO are surfaced as `unfilled`, not blocked).
- **Deliberately unchanged — the gate itself**: every no-tag form still passes. This change moved
  visibility, not a trading boundary. Reversal: revert the seed entries + drop the two aliases.
- **Stated gap**: the 4 `(copy)` bots have no seed entry at all (they are user-created via the copy
  path, not seeded — a pre-existing property: a reinstall does not recreate them). Their direct
  UPDATE to `'all-hours'` is recorded here; seeding the copy path is out of scope for #982.
