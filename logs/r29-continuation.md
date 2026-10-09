## Carried forward: #1051 → #1081 §7.3 → here

The R29 workstream (instrument form + advanced exit management) survived one consolidation close
(#1051 → #1081 §7.3, "Carry verified — nothing lost") and now needs a container again because
**#1081 is being closed** (sprint restructure, 2026-10-09, owner direction: the burndown epic's
absorbed sprints are done and its direct items are extracted).

**Nothing is re-scoped here. The seven acceptance criteria are the same seven, verbatim.**

## The seven acceptance criteria (carried)

- [ ] `instrumentForm` exists on `symbol` (cfd | spot | cash | future | option); `symbol.type` documented as the *underlying*
- [ ] Directive `instrumentTypes` is **READ** by the activation gate (declared in 118 places, branched on ZERO) — canary proves it fires
- [ ] Protocol carries a real declared form; the `inferProtocolSymbolTypes()` guess is retired
- [ ] Bot carries a form; a protocol↔bot mismatch is a config warning **and** an execution refusal
- [ ] Exit path documented as a **chain of checks** with per-bot settings; risk management is a member of it; each stage logs its decision to the DB
- [ ] Every exit decision is visible on the bot detail view
- [ ] Session calendar resolves the correct market close per symbol, in the correct timezone

## Standing context from the chain (do not re-derive)

- **R29.1 measured answer:** there are no cash equities here — everything is a CFD via MT5 — so no
  separate equity protocols are needed today. The latent-hazard tables live in #1051's history.
- **Exit authority stays ADVISORY** (register row 54): `ExitConsensusService` computes
  `PROTECT | WATCH | HOLD | NO_DATA` and nothing consumes it — deliberate, because acting on it is a
  maths change and the monitor cannot run yet (#929). Wiring it is NOT this issue's job; making the
  chain and its decisions *visible* is.
- **#1048** (hold limits) ran under #1081 §3/§7.3 and is handled separately — not folded back here.
- Related: #1047, #646.

## Why this issue exists rather than staying in #1081

`agent-issue-close-checklist` rule 4: an issue with unchecked boxes either completes them or
**extracts them into standalone issues** before closing the parent. #1081 is closing; this is the
extraction, with the carry chain visible so the next reader finds the reasoning in one hop.
