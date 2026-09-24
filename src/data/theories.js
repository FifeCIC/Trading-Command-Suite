/**
 * theories.js — the THEORY REGISTRY. Every held belief, named, dated, and falsifiable.
 * ==================================================================================
 *
 * WHY THIS EXISTS (issue #944, built 2026-09-24 under primary-agent authority)
 * ---------------------------------------------------------------------------
 * Owner, 2026-09-21: *"we might need to list our theories, potentially on the goals page, and use
 * that to list the A/B testing goals."*
 *
 * And, 2026-09-24: *"multiple levels of sanity checks or complex algorithms infused with
 * methodology is the permission I'm giving you."*
 *
 * A theory without a **falsification test** is not a theory, it is a preference. This file is where
 * a belief becomes a claim someone can check, and where the ANSWER is written down so the same
 * ground is not re-covered a month later.
 *
 * #944's own words: *"A/B cannot settle anything until the thing being tested is written down as a
 * falsifiable statement."* That is the whole point — the A/B machinery is useless while the thing
 * being compared is a memory.
 *
 * ── THE SANDBOX RULE (owner direction, 2026-09-24) ──────────────────────────────────────────────
 * The **Development** area is the sandbox: it is where an agent may build a competing approach,
 * measure it, and produce a DECISION. This registry is that sandbox's output. An experiment that
 * does not end in one of the four statuses below is a prototype, not an experiment.
 *
 * ── THE FIELDS, AND WHY EACH IS REQUIRED (from #944) ────────────────────────────────────────────
 *   statement        one sentence, falsifiable. "the market slows" is not testable.
 *   predictedDirection  what must be true for the theory to HOLD. Without it, any result "supports" it.
 *   measure + unit   the exact quantity AND its unit. `movePct`, never "movement".
 *   window           a claim about WHEN must name when — period, sessions, symbols.
 *   status           untested | testing | supported | refuted. The whole point of the file.
 *   evidence         what was observed. ⚠️ `basis` grades how strong that is — see below.
 *   falsification    the test that would refute it. Required, always.
 *   decision         what we DID about it. Required once there is an answer.
 *
 * ── ⚠️ `evidence.basis` — a reliability scale, so a cited number is never mistaken for a measurement
 * -------------------------------------------------------------------------------------------------
 *   'measurement' — WE measured it, here, and `n` is the sample size (a positive integer).
 *   'code-read'   — the refutation is a fact about the SOURCE (e.g. "this expression does not read
 *                   that field"), so there is no sample. `n` MUST be null. ⚠️ This is the basis the
 *                   repo's own instructions warn about: read the WRITER, not the reader.
 *   'cited'       — carried from an issue or another agent. `source` MUST name it. ⚠️ A cited number
 *                   is a CLAIM, not an observation — `validate-theories.cjs` forces it to admit that.
 *
 * `scripts/validate-theories.cjs` enforces all of the above and is canaried in both directions.
 * It runs in `prebuild`, so a theory cannot be added without a falsification test.
 */

export const THEORY_STATUSES = ['untested', 'testing', 'supported', 'refuted'];
export const EVIDENCE_BASES = ['measurement', 'code-read', 'cited'];

export const THEORIES = [
  // ── Scoring ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'weight-strategy-selects-denominator',
    raisedAt: '2026-09-20',
    statement:
      'Changing `weightStrategy` changes the composite, because it selects which denominator the directional score is divided by.',
    predictedDirection:
      'The same symbol, scored under `group-weighted` and `maxscore-weighted`, returns a DIFFERENT `signalPct`.',
    measure: 'signalPct',
    unit: '% of the protocol configured directional capacity',
    window: 'Any. Tested on a fixed 120-bar fixture, one symbol (TESTX), no session filter.',
    status: 'refuted',
    evidence: {
      basis: 'measurement',
      n: 3,
      result:
        'Identical composite for `group-weighted`, `maxscore-weighted` AND an unrecognised value (`not-a-convention`). The field is only echoed into the payload; the denominator is hardcoded `configured-capacity` at protocol-gating.service.ts L1152.',
      measuredAt: '2026-09-24',
      source:
        'This repo — nest/src/modules/scoring/weight-strategy-inert.spec.ts (6 tests, canaried both directions)',
    },
    falsification:
      'Score one symbol under both conventions and compare `signalPct`. Any non-zero difference supports the theory and must fail `weight-strategy-inert.spec.ts`.',
    decision:
      'DECLARED INERT. #919 asked for a rename of `group-weighted`; renaming an unread field would have polished a control that does nothing, so the field is declared inert in the service doc block, the UI labels group weights "not applied", and a canaried guard holds the invariance. ⚠️ Wiring it is a MATHS change (it moves every percentage) and needs an A/B copy.',
    area: 'scoring',
    issue: 919,
  },
  {
    id: 'group-weights-weight-the-composite',
    raisedAt: '2026-09-20',
    statement:
      "A group's `config.weight` changes how much its directives contribute to the composite.",
    predictedDirection:
      'Raising a group weight raises the composite contribution of that group’s directives, so two protocols with equal directives but different group weights score differently.',
    measure: 'composite',
    unit: 'raw additive points (not a percentage)',
    window: 'Any. Inspected against `scoreWithGating`’s assembly, 2026-09-24.',
    status: 'refuted',
    evidence: {
      basis: 'code-read',
      n: null,
      result:
        '`config.weight` does not appear in `scoreWithGating`’s assembly — the composite is the RAW sum of directional directive scores (risk-multiplied). The service’s own note (2026-09-03) says the weights shown in the registry are "aspirational until #718 lands". Every Protocols-page group weight is displayed, stored and saved, and never applied.',
      measuredAt: '2026-09-24',
      source: 'nest/src/modules/scoring/protocol-gating.service.ts doc block + assembly',
    },
    falsification:
      'Score a protocol, then change one group weight and re-score the same bars. An unchanged composite refutes it; a changed one supports it.',
    decision:
      'LABELLED NOT APPLIED on 5 surfaces (Protocols Registry old+new, Create Protocols, Scoring Activity Logs, META.Stack Explorer) — #919 item 4. Applying the weights would be a maths change. #718 (per-protocol gates) is the issue that would make them real.',
    area: 'scoring',
    issue: 919,
  },

  // ── Data / processing ─────────────────────────────────────────────────────────────────────────
  {
    id: 'most-scoring-is-on-untradeable-symbols',
    raisedAt: '2026-09-22',
    statement:
      'Most scoring output is produced for symbols that cannot trade, so most of the work is wasted.',
    predictedDirection:
      'The large majority of score rows in a 24h window carry a signal no bot can act on or a state that forbids trading.',
    measure: 'share of score rows that cannot become a trade',
    unit: '% of rows in a 24h window',
    window: '24h, all symbols, all protocols.',
    status: 'testing',
    evidence: {
      basis: 'measurement',
      n: 6787,
      result:
        '⚠️ TWO MEASUREMENTS DISAGREE AND THE POPULATIONS DIFFER. (1) `score` table, 24h: 6,787 scores produced, 5,764 = 85% HOLD/NO_DATA (#956, 2026-09-22). (2) `breakdown.signal`, same day: BUY 3,387 / HOLD 1,611 (28%) / STRONG_BUY 662 / STRONG_SELL 56 / SELL 40, with no NO_DATA rows at all. The 28% and the 85% are NOT the same quantity, and neither has been reconciled. A tighter (protocol × symbol) reading suggested ~33% but was never verified.',
      measuredAt: '2026-09-24',
      source: '#956 body (measurement 1) + this session’s independent query (measurement 2)',
    },
    falsification:
      'Count, in one window, the score rows whose (symbol × protocol) is subscribed by an active bot AND whose market is open. If that share is high, the theory is dead.',
    decision:
      'PARTIALLY ACTED. The market-closed half was gated (#956 / R13) on the owner’s ruling that removing untradeable work is a development decision, not an A/B maths change. The "no subscribed bot" half is NOT gated. ⚠️ Re-measure before quoting any single percentage — the 85% does not reproduce against `breakdown.signal`.',
    area: 'data',
    issue: 956,
  },
  {
    id: 'closed-market-scores-cannot-become-signals',
    raisedAt: '2026-09-22',
    statement:
      'Scoring a symbol whose market is closed produces no output any consumer can act on.',
    predictedDirection:
      'Score rows written while `marketStatus.open` is false never lead to a queued signal or an order.',
    measure: 'count of score rows where marketStatus.open = false',
    unit: 'rows (and % of the window’s score rows)',
    window: '24h, all symbols.',
    status: 'supported',
    evidence: {
      basis: 'measurement',
      n: 5756,
      result:
        '840 of 5,756 score rows in a 24h window carried `marketStatus.open = false` — 14.6% of the window produced values no bot could act on. Baseline taken BEFORE the gate shipped, so it is a clean before-measurement.',
      measuredAt: '2026-09-23',
      source: '#956 / R13 baseline query, recorded in this repo',
    },
    falsification:
      'Find a score row written while the market was closed that later became a queued signal or an order. One example refutes it.',
    decision:
      'GATED. `signal-envelope.service.ts` now skips a symbol whose market is closed, before the envelope is built, and reports `ladder.skipped`. Guard: 4 tests asserting the gate’s PLACEMENT (gate index < buildEnvelope index), its fail-open behaviour, and CRLF-safe matching. Owner ruling: a development decision, NOT an A/B maths change — nothing with performance history is overwritten.',
    area: 'scoring',
    issue: 956,
  },

  // ── Trading / exits ───────────────────────────────────────────────────────────────────────────
  {
    id: 'the-stop-loss-is-where-the-money-dies',
    raisedAt: '2026-09-23',
    statement: 'The loss in this system comes from stop-loss exits, not from the entry decision.',
    predictedDirection:
      'Stop-loss closes carry a large negative total P&L while terminal (manual/bot) closes are net positive, so the entry side is not the problem.',
    measure: 'total P&L per close reason',
    unit: 'account currency (£), whole history',
    window: 'Entire recorded history at 2026-09-23; all symbols, all bots.',
    status: 'testing',
    evidence: {
      basis: 'cited',
      n: 78,
      result:
        'broker:sl — 22 trades, −£215.97. system:time-stop — 13 trades, −£20.34. broker:terminal — 43 trades, +£142.13. Overall: 41 wins / 39 losses (51% win rate), payoff 0.62, expectancy ≈ −£1.18/trade. ⚠️ CITED from #960’s measurement, not re-measured here. One week, one configuration — which is exactly the input A/B exists to settle.',
      measuredAt: '2026-09-23',
      source: '#960 sprint body (Sprint: Strategy Establishment)',
    },
    falsification:
      'Split realised P&L by close reason over a longer window. If stop-loss closes are not the dominant loss, the theory is dead and the entry side becomes the suspect.',
    decision:
      'OPEN — this is #960’s thesis, and #960 gates its Tier 1 behind Tier 0 (#929, #660, #956). ⚠️ It also cannot be settled by A/B yet: the instrument is blocked (see the note on the "group vs maxscore weighting" test, whose two arms scored identically for a second, independent reason).',
    area: 'trading',
    issue: 960,
  },
  {
    id: 'guardian-trail-cuts-winners-early',
    raisedAt: '2026-09-21',
    statement:
      'The stop guardian trails the stop so close to price that a winner is exited at a fraction of its target before the move has room to complete.',
    predictedDirection:
      'Trades closed by `broker:sl` carry an achieved move far below the planned target, and their stop sits much closer to entry than the strategy’s DECLARED stop distance.',
    measure: 'achieved move as a multiple of the risk distance (R)',
    unit: 'R — dimensionless: |exit − entry| ÷ |entry − sl|',
    window:
      'Live demo accounts, all symbols, closed trades. Afflicted = stop within 0.15% of entry while the declared stop is ~0.8–0.9%.',
    status: 'testing',
    evidence: {
      basis: 'measurement',
      n: 14,
      result:
        'BEFORE the trail floor: 12 trades carried a stop within 0.15% of entry — 2 on 09-20 and 10 on 09-21 — while their TP stayed at the declared ~1%. Four had the stop ABOVE entry on a BUY (EURCAD 1.60873→sl 1.60905; AUDJPY 112.177→112.231; NZDJPY 90.101→90.153): trailed into profit at ~0.02%, then stopped out, several still booking a small gain (+0.17, +0.26, +0.48, +2.47). AFTER the floor landed (09-21 19:13, commit 5c2336c): 0 on 09-22, **2 on 09-23** — one opened 11:24 and closed 12:37, entirely post-fix — and 0 on 09-24. Over the 14 days, achieved R was 0.2–0.8R against a planned 1.0–1.2R on the majors. ⚠️ SECOND, INDEPENDENT CHECK from the guardian own record (`stop_adjustment`, the 452 rows whose reason string carries a `dist=` figure): average recorded trail distance **0.9546%** — so the floor HOLDS on average — but **36 adjustments recorded below 0.5%, minimum 0.299%**, and the guardian is very active (214 adjustments on 09-23, 184 on 09-21, 68 today across 6 symbols). ⚠️ Whether those 36 breach the DECLARED floor cannot be decided without joining each position own declared `slPct` per row, which is NOT done — a `dist=0.299%` is a breach for a ~1% strategy and legitimate for a 0.3% one.',
      measuredAt: '2026-09-24',
      source: 'Live `trade` table, this session (7- and 14-day windows); fix attributed via git log -S on stop-guardian.service.ts',
    },
    falsification:
      'Turn the trailing tighten off on a COPIED configuration and re-measure achieved R on the same symbols. Winners still exiting at ~0.2R would refute it; the residual instances disappearing would confirm the trail is the whole mechanism.',
    decision:
      'The trail-distance FLOOR shipped 09-21 19:13 (#927): a tightening may never leave the stop closer to price than the declared stop distance. Measured effect: **10 afflicted/day → 0–2/day**. ⚠️ NOT closed: the residual is unexplained, and the trail DISTANCE itself is maths — changing it needs a copied configuration and a monitored comparison (SETTLED-DECISIONS row 21), which A/B cannot yet provide (#929).',
    area: 'trading',
    issue: 916,
  },
  {
    id: 'the-book-loses-money-broadly',
    raisedAt: '2026-09-23',
    statement:
      'The trading book loses money across many symbols, so the entry logic is broadly unprofitable.',
    predictedDirection:
      'Losses should be spread across symbols, and removing any single symbol should leave the book substantially negative.',
    measure: 'total P&L, and expectancy per trade',
    unit: 'account currency (£)',
    window:
      'Closed trades since the trail-distance floor landed (09-21 19:13) — 65 trades, all symbols, live demo accounts.',
    status: 'refuted',
    evidence: {
      basis: 'measurement',
      n: 65,
      result:
        'Expectancy is −£1.89 per trade overall — but FIVE XAUUSD stop-outs carry −£117.39 of the −£122.56 total. The other 60 trades total −£5.17, an expectancy of −£0.09 (effectively flat). All five are gold, one sized 0.1 lots and losing £52.26 on its own. ⚠️ Also measured: the same 65 trades split BEFORE the floor (61 trades) give expectancy −£0.70, so the post-fix window looks WORSE — but 5 trades drive that too, and a verdict on it would be the thin-sample defect SETTLED-DECISIONS row 26 names. ⚠️ One of the five has `pnl` and `exitPrice` inconsistent by 3.6x (implied contract 274.1 against a consistent 75.75 elsewhere) while `pnlInvalid = 0` — an unverified lead, not a finding.',
      measuredAt: '2026-09-24',
      source: 'Live `trade` table, this session; fix boundary from git log -S on stop-guardian.service.ts',
    },
    falsification:
      'Re-run the split over a longer window, or on a configuration with gold disabled. A remaining book that is still substantially negative refutes this and restores the original theory.',
    decision:
      'NOT acted on, deliberately. 65 trades with 5 carrying the result cannot support a verdict, and the honest next step is gold SIZING rather than another exit change — #960 requirement 3 already records two gold bots risking £980.88 and £245.22 against a £100 ceiling. The pnl/exitPrice inconsistency is a separate lead.',
    area: 'trading',
    issue: 960,
  },
];

export default THEORIES;
