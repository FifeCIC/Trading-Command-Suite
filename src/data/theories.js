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
        'BEFORE the trail floor: 12 trades carried a stop within 0.15% of entry — 2 on 09-20 and 10 on 09-21 — while their TP stayed at the declared ~1%. Four had the stop ABOVE entry on a BUY (EURCAD 1.60873→sl 1.60905; AUDJPY 112.177→112.231; NZDJPY 90.101→90.153): trailed into profit at ~0.02%, then stopped out, several still booking a small gain (+0.17, +0.26, +0.48, +2.47). AFTER the floor landed (09-21 19:13, commit 5c2336c): 0 on 09-22, **2 on 09-23** — one opened 11:24 and closed 12:37, entirely post-fix — and 0 on 09-24. Over the 14 days, achieved R was 0.2–0.8R against a planned 1.0–1.2R on the majors. ⚠️ SECOND, INDEPENDENT CHECK from the guardian own record (`stop_adjustment`, the 452 rows whose reason string carries a `dist=` figure): average recorded trail distance **0.9546%** — so the floor HOLDS on average — but **36 adjustments recorded below 0.5%, minimum 0.299%**, and the guardian is very active (214 adjustments on 09-23, 184 on 09-21, 68 today across 6 symbols). **RESOLVED 2026-09-24 — these are NOT breaches.** `trading_strategy.slPct` is per bot and spans **0.3% to 3%** (1% on 13 bots, 3% on 10, 1.5%, 0.4%, 0.5%, 0.3%, 2%, 0.6%), and the minimum observed distance (**0.299%**) matches the tightest declared floor (**0.3%**). The floor holds at the floor. ⚠️ My first framing called this an open residual; it is withdrawn, and the correction points instead at bots that DECLARE a stop as tight as 0.3%.',
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
  {
    id: 'ab-arm-pnl-can-be-attributed',
    raisedAt: '2026-09-21',
    statement:
      'A trade row recorded against an A/B arm carries a P&L that can be attributed to that arm and compared against the other arm.',
    predictedDirection:
      'Each arm accumulates its own P&L across its rows, so the two arms can be compared on realised outcome.',
    measure: 'per-arm total P&L, and per-row P&L against that row recorded size',
    unit: 'account currency (£); implied contract size (dimensionless)',
    window: 'All closed trades. A/B rows are identified by the `AB-` strategy prefix — 19 rows.',
    status: 'refuted',
    evidence: {
      basis: 'measurement',
      n: 19,
      result:
        'The AB arm total P&L is −£35.41 across 19 rows, and **ONE row is 100% of it**. That row (`AB-B 929 XAU M15`) records `quantity` 0.02 while its P&L implies a contract size of **274.1** against a consistent **75.75** (= 100oz ÷ GBPUSD 1.32) everywhere else — **3.6x** — with `pnlInvalid = 0` and `abTestId` NULL. 4 of the 19 rows have `pnl` NULL. So the instrument cannot produce a per-arm comparison today. ⚠️ An initial misreading was REFUTED by the same data and is recorded so it is not re-derived: a NULL `ticket` is NOT distinctive to the A/B path — 106 of 115 bot rows and 108 of 114 manual rows are NULL too.',
      measuredAt: '2026-09-24',
      source: 'Live `trade` table, this session',
    },
    falsification:
      'Recompute each arm P&L from broker deals rather than from `trade` rows. If the two arms separate cleanly, this is refuted.',
    decision:
      'NOT acted on — it belongs with #929 and #965. **The instrument has a SECOND, independent defect**: even when A/B runs, its per-arm P&L is not attributable. Fixing attribution is a prerequisite for any A/B verdict, and it is an attribution fix, not a maths change.',
    area: 'trading',
    issue: 929,
  },
  {
    id: 'gold-is-the-loss-centre',
    raisedAt: '2026-09-23',
    statement:
      'Gold is unprofitable across every path that trades it — the bots, the manual route, and the A/B arm.',
    predictedDirection:
      'Every XAUUSD source shows a negative total, and removing gold leaves the book close to flat.',
    measure: 'total P&L per bot, grouped by the recorded strategy',
    unit: 'account currency (£)',
    window: 'All closed trades carrying a non-null pnl. Gold sources = the four active XAUUSD bots, the AB-B arm, and manual gold.',
    status: 'refuted',
    evidence: {
      basis: 'measurement',
      n: 11,
      result:
        '⚠️ REFUTED ON RE-MEASUREMENT 2026-09-24, by the #960 Tier 1 truth pass (`nest/scripts/audit-strategy-realism.cjs`). **Gold Swing 1H is net +£26.65** (2 trades: +£41.66 then −£15.01), so gold is NOT unprofitable on every path. ⚠️ The original evidence below listed only THREE of the four bots, so its sum never covered the scope its own statement claimed — a `supported` status resting on evidence narrower than the claim. Corrected per-bot totals, 11 trades, net **−£23.65**: Swing 1H +£26.65 (2), Scalp M5 −£12.27 (3), Day-Trade M15 −£15.67 (4), Position 4H −£22.36 (2). The largest single gold loss is **£31.07**, well under the £100 ceiling. Original text follows, unchanged: Every gold source is negative: AB-B 929 arm −£35.41 (1 trade), Gold Position 4H −£22.36 (2), Gold Day-Trade M15 −£15.67 (4), Gold Scalp M5 −£12.27 (3) — **−£85.71 from 10 bot trades**. Two manual gold trades lost −£52.26 and −£13.68 as well. By contrast the FX session bots average −£0.29 to −£2.80 per trade and the manual/untagged bucket is −£0.08 per trade over 112 rows, i.e. flat. The declared stop on gold spans **0.3%–3%**, with Gold Scalp M5 at **slPct 0.3% / tpPct 0.5%** — 0.3% of XAUUSD is a move gold makes in minutes. ⚠️ Some rows in these buckets have NULL pnl (4 of the 19 AB rows, 86 of 112 manual), so the bucket totals understate the trade count but not the sign.',
      measuredAt: '2026-09-24',
      source: 'Live `trade` table grouped by `strategy`; declared stops from `trading_strategy.slPct`',
    },
    falsification:
      'Disable gold on a COPIED configuration and measure the remaining book. If it is still substantially negative, gold is not the sole centre; if a gold bot turns positive over a longer window, this weakens.',
    decision:
      'SURVIVOR AFTER REFUTATION: three of the four gold bots are net negative and the four TOGETHER are net −£23.65. What is refuted is only the word "every". Ran 2026-09-24 as #960 Tier 1: `nest/scripts/audit-strategy-realism.cjs` reports 0 of 33 active bots breaching the £100 worst-loss ceiling and none exceeding the 60% stop-out threshold, so the tier\'s premise (2 gold bots risking £980.88 and £245.22 per trade) does not reproduce against realised losses. NO maths changed — `slPct`/`baseSize` are maths (SETTLED-DECISIONS row 21) and A/B cannot report yet (#929), so the available action was the written truth pass, which is now a guard rather than a one-off. ⚠️ Only the word "every" is refuted — the CENTRALITY claim survives strongly and is recorded separately as `gold-dominates-the-books-loss` (XAUUSD is 91% of the book net loss).',
    area: 'trading',
    issue: 960,
  },
  {
    id: 'gold-bots-risk-over-the-ceiling',
    raisedAt: '2026-09-24',
    statement:
      'The gold bots place trades whose risk per trade exceeds the £100 ceiling — #960 names two of them risking £980.88 and £245.22 per trade.',
    predictedDirection:
      'If true, the bots\' own realised losses should be in the hundreds of pounds, and their declared size × stop should exceed £100 by a wide margin.',
    measure: 'largest realised single-trade loss per bot, and stop-out rate per bot, across all 33 active bots',
    unit: 'account currency (£) and percent of closed trades',
    window: 'All closed trades carrying a non-null pnl. Ceiling taken as £100 per #960; no canonical config home for it was found (searched nest/src and nest/prisma, 2026-09-24).',
    status: 'refuted',
    evidence: {
      basis: 'measurement',
      n: 33,
      result:
        'REFUTED. The largest single loss anywhere in the book is **£31.07** (Gold Day-Trade M15, `broker:sl`, 2026-09-17) — 31× smaller than the £980.88 and 8× smaller than the £245.22 that #960 attributes to two gold bots. No bot of 33 breaches the £100 ceiling. Stop-out rates are 0–50%, all below the 60% threshold, so no bot\'s stop sits inside the noise. Per gold bot: Position 4H worst £22.36 (0% stopped out, 2 trades), Day-Trade M15 £31.07 (50%, 4), Swing 1H £15.01 (50%, 2), Scalp M5 £9.44 (33%, 3). ⚠️ #960\'s figures are therefore NOT realised losses; they look like a modelled notional (size × stop distance × contract), which the first version of the audit also got wrong by ~100,000× on FX. Nothing in the audit now models risk — it reads the loss actually taken.',
      measuredAt: '2026-09-24',
      source: '`nest/scripts/audit-strategy-realism.cjs` against the live `trade` and `trading_strategy` tables',
    },
    falsification:
      'Find a single closed trade on any bot with |pnl| > £100, or a bot whose stop-out rate is at or above 60% over 3+ trades. Either would reinstate the claim.',
    decision:
      'Do NOT re-derive size for the gold bots on the strength of #960\'s figures. Tier 1 keeps its value — exits ARE defined on all four bots (0.3/0.5 to 3/6) and the audit now runs as a guard — but the alarming risk number that motivated the tier does not exist in the data. If a different, real over-risk case exists, it will show as LOSS-OVER-CEILING on the guard, which exits non-zero.',
    area: 'trading',
    issue: 960,
  },
  {
    id: 'gold-dominates-the-books-loss',
    raisedAt: '2026-09-24',
    statement:
      'The book is not losing broadly — it is losing on one symbol. XAUUSD accounts for almost all of the net loss, and the four gold bots are only part of that.',
    predictedDirection:
      'If true, removing XAUUSD leaves the book close to flat, and XAUUSD shows far more loss per trade than any other symbol.',
    measure: 'net P&L grouped by symbol, and XAUUSD split into the four gold bots versus every other gold path',
    unit: 'account currency (£), per symbol and per bucket',
    window: 'All 254 closed trades. 10 rows carry a NULL pnl and are excluded from every SUM.',
    status: 'supported',
    evidence: {
      basis: 'measurement',
      n: 59,
      result:
        'SUPPORTED, and it is the largest single fact about this book. Total net **−£91.23** over 254 closed trades (−£0.37 each). XAUUSD alone is **−£82.79** over 59 trades (−£1.40 each) — **91% of the entire net loss**. Every other symbol combined is **−£8.44 over 185 trades**, i.e. flat at −£0.05 each. Within gold the split is the surprising part: the four gold bots account for only **−£23.65 over 11 trades**, while the other **48 gold trades are −£59.14** — the manual, untagged and A/B paths. The largest losses in the book are two untagged manual XAUUSD trades (−£65.25 on 2026-09-11, −£52.26 on 2026-09-21), the A/B arm (−£35.41) and Gold Day-Trade M15 (−£31.07). ⚠️ The recent window is the worse one: the **71 trades closed since 2026-09-21 19:13 net −£106.81**, more than the whole book nets, which means the earlier period was net positive. **I have not isolated why**, and the coincidence with the stop-guardian change on that date is NOT a cause — two things changed together and I did not separate them.',
      measuredAt: '2026-09-24',
      source: 'Live `trade` table via the mysql CLI; cross-referenced with the Tier 1 comment on #960',
    },
    falsification:
      'Show a non-gold symbol, or the non-gold total, with a loss comparable to gold, or show the four gold bots contributing the majority of the gold loss. Either breaks the claim.',
    decision:
      'Do NOT act on this by editing the maths. `slPct`/`baseSize` are maths (SETTLED-DECISIONS row 21) and A/B needs a LARGE SAMPLE rather than being unable to report — ⚠️ corrected 2026-10-06: attribution resolves (`unattributed: 0`, arms hold separate tickets) and the verdict machine computes and refuses correctly; the running pair sits at 8 vs 5 closed against a ≥30-per-side bar. (It previously read "A/B cannot report yet (#929)" — a claim carried from 2026-10-01 that re-measurement did not support.) What this changes is PRIORITY: the largest lever is gold exposure, and 48 of the 59 gold trades are not attributable to a bot at all — that is the #949 attribution defect, not a strategy result. Attribution is therefore a prerequisite for deciding anything about gold, because until it is fixed the manual and bot paths cannot be told apart. The MAGNITUDE is small (a £91 net on a demo book); the SHAPE is the finding.',
    area: 'trading',
    issue: 960,
  },
    {
      id: 'pivot-resistance-predicts-the-turn',
      raisedAt: '2026-09-25',
      statement:
        'A swing-pivot resistance above price predicts where an advancing move will turn — so the nearest confirmed pivot high is a usable ceiling for an open position, and its proximity can drive sim-TSL gap closure (#936).',
      predictedDirection:
        'If true, price should reverse at a pivot level MORE than at an ordinary high sitting the same distance away. The test is the CONTROL ARM, not the hit rate: without it, "price reached the level" is a fact about a random walk.',
      measure:
        'giveback after first touch — how far price falls back from the level, median, pivot level versus an ordinary (non-pivot) high in the identical causal window',
      unit: 'percent of price, median; plus distance-to-level, reach rate and overshoot',
      window:
        '1h 2026-01-30 to 2026-09-25 (40 symbols, 25,131 observations), 15m (30 symbols, 53,906) and 1d (58 symbols, 7,577). Horizon = 24 / 96 / 10 bars held forward.',
      status: 'refuted',
      evidence: {
        basis: 'measurement',
        n: 25131,
        result:
          'REFUTED on three timeframes, and the refutation is the CONTROL that #989 did not ask for. (1) THE HEADLINE NUMBER IS AN ARTEFACT: the nearest pivot high sits a median **0.3%** above price (p25 0.1%), so "62.5% of ceilings were reached" and "realised/predicted = 1.001" are arithmetic, not prediction. The second version of this test reported a suspiciously tight p25–p75 of 0.999–1.004 and that tightness is what exposed it. (2) GIVEBACK — the only metric that can settle the claim, because a level that says "price turns here" must reverse price MORE than an ordinary high — is **0.6% pivot vs 0.5% control on 1h**, **0.5% vs 0.5% on 15m**, and **2.5% vs 2.8% on 1d**, where the control reverses MORE. A confirmed pivot is indistinguishable from an arbitrary high, and on the daily timeframe it is marginally worse. (3) Overshoot past the level is a median 0.3% on 1h with a p90 of 3.0% — the level is a waypoint, not a limit. (4) DETECTION LAG is **3 bars on every one of 2,675 pivots** (PIVOT_WINDOW, exactly), so on 1h a ceiling is identifiable three hours AFTER the high exists; the high is always in the past by the time it is usable. ⚠️ Method disagreement is real and does not rescue it: swing pivot vs round number vs 20-bar high differ by a median 1.1% and a p90 of 8.2% of price, so "which level" is not even well defined.',
        measuredAt: '2026-09-25',
        source:
          '`scripts/measure-sr-levels.cjs` — a causal replay over the live `marketbar` table that never reads past bar i, mirroring the shipped `support-resistance.directive.ts` constants (LOOKBACK 30, PIVOT_WINDOW 3)',
      },
      falsification:
        'Show a timeframe, symbol set or horizon where pivot-level giveback exceeds the control arm by a margin larger than the sampling spread. The control is in the same script and runs on every invocation, so this is re-testable in one command.',
      decision:
        'Do NOT wire a level directive into the guardian, and do NOT configure sim-TSL gap closure from predicted proximity. #936 correctly listed "predicted proximity → gap closure rate" as its input; that input does not exist. The quick route was the GATE for #989\'s advanced route and it has failed, so the page is not built on the accuracy claim. ⚠️ What survives is worth publishing as a finding rather than as a predictor: the 3-bar detection lag is a hard constraint on ANY level method, and method disagreement (median 1.1%, p90 8.2%) says the "which level" question is unresolved. Those are page content; the accuracy claim is not.',
      area: 'trading',
      issue: 989,
    },
    {
      id: 'upside-exhaustion-predicts-giveback',
      raisedAt: '2026-09-25',
      statement:
        'An open long whose bars DECELERATE into a new high — price still rising, but less progress per bar than the bars before it — is nearer a local top than one reaching the same high at a steady or accelerating rate. So the deceleration is a usable exit signal for a position that is already open.',
      predictedDirection:
        'Flagged positions give back MORE of their peak before closing than unflagged ones. Giveback is the measure, and a flag that changes nothing is a FAILED flag — not a neutral result.',
      measure:
        'peak giveback per closed position = (peak favourable price − exit price) ÷ peak favourable price, split by whether the deceleration flag fired',
      unit: 'percent of price — median and p75, with n per arm',
      window:
        'Closed trades on bots with the observer enabled, once n ≥ 30 closed per arm. No verdict below that, and the observer refuses one.',
      status: 'testing',
      evidence: {
        basis: 'code-read',
        n: null,
        result:
          'NOT YET MEASURED — this entry exists so the claim is FALSIFIABLE BEFORE the observer is built, which #995 requires and which is the whole point of the registry. The one thing established so far is a CONSTRAINT, not a result: the guardian evaluates **5m bars with limit=30** (2.5 hours of history — measured at `stop-guardian.service.ts:624`), while BOTH existing exhaustion directives declare `minBars {1d: 19}` and suitability `minTimeframe: M15`. Neither can be used as-is, so this signal must be computable inside 30 five-minute bars. ⚠️ That constraint is why the observer computes the metric itself rather than importing a directive — the same reason `observeSimulatedTsl()` (#936) does not add one either.',
        measuredAt: '2026-09-25',
        source:
          '`stop-guardian.service.ts:624` (the guardian’s own bar request) + `momentum-exhaustion.directive.ts` / `directive-suitability.registry.ts` metadata',
      },
      falsification:
        'Run the observer until n ≥ 30 flagged and n ≥ 30 unflagged closed positions, then compare peak giveback. **If flagged positions do not give back MORE, the signal is not an exit signal** and escalation to a guardian directive is refused. The comparison is the whole test: a difference in the OTHER direction is also a refutation.',
      decision:
        'OBSERVER ONLY, default OFF, per-bot. Nothing acts on the flag. ⚠️ Escalating it means adding an id to `STOP_GUARDIAN_DIRECTIVES`, which changes how much a tradeable position moves its stop — that is maths (`maths-change-requires-ab`) and needs a COPIED configuration, which #929’s precondition still blocks from reporting. ⚠️ DIRECTION IS THE POINT: both existing exhaustion directives are `directionBias: bullish` — "the DOWN-move is exhausting, so buy the dip". This is the mirror, "the UP-move is tiring", and there is no such signal in the app today (#995).',
      area: 'trading',
      issue: 995,
    },

  // ── The owner's vision for what the scoring engine should be able to reach ─────────────────────
  {
    id: 'a-protocol-can-reach-80-percent-of-configured-capacity',
    raisedAt: '2026-10-14',
    statement:
      'A protocol reaches at least 80% of its CONFIGURED directional capacity on at least one tick per week, so a percentage expresses the significance of a moment rather than a fraction diluted by silent directives.',
    predictedDirection:
      'Some protocol’s ceiling — `MAX(rawComposite / configuredSignalMax)`, measured over the retained window — sits at or above 80%.',
    measure: 'breadth ceiling, `MAX(breakdown.rawComposite / breakdown.configuredSignalMax × 100)`',
    unit: '% of the protocol’s configured directional capacity',
    window:
      'Retained `score` window (30 days), every protocol with >100 ticks, 2026-10-14. ⚠️ The window must be stated because `score` rotates — see `ceilingWindowDays` on `GET /api/scoring/gated/thresholds`.',
    status: 'refuted',
    evidence: {
      basis: 'measurement',
      n: 16,
      result:
        'REFUTED on the configured scale: the fleet ceiling is 6.2%–31.0% (`hourly-3dir-v1` 30.3, `momentum-stock-v1` 28.8, `spy-speed-v1` 28.8, `dow-speed-v1` 24.9, `forex-session-v1` 23.0, `xau-speed-4h` 6.2). **Nothing reaches 40%, let alone 80%.** ⚠️ But the SAME 16 protocols reach **93–100%** on the observed scale (`rawComposite / observedSignalMax`) — 10 of them at exactly 100%. The owner’s intent IS met; the DENOMINATOR is what hides it.',
      measuredAt: '2026-10-14',
      source:
        '`score.breakdown` — `SELECT strategyId, MAX(rawComposite/configuredSignalMax*100), MAX(rawComposite/observedSignalMax*100) … HAVING ticks > 100`',
    },
    falsification:
      'Read both ceilings per protocol. A breadth ceiling ≥ 80% for any protocol refutes this — the ratio of the two ceilings IS the dilution, so the gap between them names the cause directly. ⚠️ Both numbers must be reported together: reporting only the configured one is what produced the belief in the first place.',
    decision:
      'THE INTENT IS RIGHT AND THE SCALE IS THE QUESTION — do not weaken the target. Two consequences, neither of which is taken here: (1) **the 2026-09-15 ÷~6.3 rescale** (`ENTRY_THRESHOLD` 40 → 6, gate 65 → 13, style bars 45–80 → 7–13) exists to keep thresholds meaningful after ADR-011 moved the denominator to the configured capacity — it did NOT create the dilution, it followed it; (2) **choosing which scale drives the GATE is the open decision** (#915 option B). ⚠️ This refutes the *number*, not the design: a protocol CAN be judged on conviction, where 10 protocols already hit 100%. ⚠️ NOT a maths change made here — moving a gate admits trades and needs a copied config + monitored comparison. ⚠️ **A CEILING IS THE WRONG METRIC — measured the same day, the DISCRIMINATING statistic is the FREQUENCY of strong ticks** (`pct_of_ticks_at_80`): `spy-speed-v1` **31.2%**, `qqq-speed-v1` 23.9, `xau-speed-v1-copy` 19.1, `btc-speed-v1` 17.9, `vix-short-v1` 11.3, `btc-scalp-v1` 8.8, `momentum-stock-v1` 2.3, `xau-speed-v1` 2.0, `forex-session-v1` **0.6**, `gold-macro-v1` **0.0**, `xau-speed-4h` **0.0**. That answers the owner’s own worry — *"the system holds us back from identifying what might be a truly weak or over complex protocol"* — because a ceiling cannot rank protocols when most reach 100%, while the frequency separates them by a factor of 50. ⚠️ `forex-session-v1` is the instructive row: **86.6% of ticks at ≥60% but only 0.6% at ≥80%** — consistently moderate, never exceptional, which is a different finding from weak.',
    area: 'scoring',
    issue: 915,
  },
  {
    id: 'one-directive-protocol-escapes-denominator-dilution',
    raisedAt: '2026-10-14',
    statement:
      'A protocol built from ONE signal directive (plus one opportunity directive) reaches a high percentage of its configured capacity on some ticks, because a single directive cannot be diluted by other directives reading neutral.',
    predictedDirection:
      'Scoring that protocol continuously for a day produces a breadth ceiling at or above 60% — materially ABOVE the 6.2–31% band every multi-directive protocol sits in.',
    measure: 'breadth ceiling of the one-directive protocol, beside its conviction reading',
    unit: '% of that protocol’s configured directional capacity',
    window:
      'One full trading day of continuous scoring, one symbol, compared against the same protocol’s `observedSignalMax` reading and against the multi-directive fleet baseline measured 2026-10-14.',
    status: 'supported',
    falsification:
      'Score the one-directive protocol for a full day and read its ceiling. ⚠️ **BOTH outcomes are informative, which is why this test is worth running:** a ceiling ≥ 60% says the SILENT DIRECTIVES are the dilution and directive count is the lever; a ceiling that stays inside 6.2–31% says directive count is NOT the cause and the **capacity accounting itself** is wrong — which is a materially different, and worse, finding. A ceiling BELOW the fleet band would point at capacity being over-counted for a single directive.',
    evidence: {
      basis: 'measurement',
      n: 1400,
      result:
        'ANSWERED — the ≥60% branch. **✅ CONFIRMED IN THE LIVE LOOP, END TO END (2026-10-15 13:55:55Z).** `probe-1dir-v1` recorded `score.value = 60` with the stored breakdown `rawMax: 100, signal: STRONG_BUY, ema-structure score 60/100, signalClass bullish, inSignal true`; `protocol_score_status` flipped from `no-data` to `scoring` with `symbolsScored: 1`; a `strategy_signal_queue` row was **executed**; and a live trade was placed — EURUSD buy 0.01 @ 1.12167, `magic 234143`, status open. **60 points became 60%, and 60% traded.** The same 60 points inside a 10-directive protocol (`xau-speed-v1`, capacity 910) is **6.6%** — a 9x difference from the denominator alone. **Denominators, read from the running app:** the one-directive probes report `configuredSignalMax: 100` and `140`; `xau-speed-v1` is **910** (10 non-gate directives) and `eurusd-macro-v1` is **830**. **Same directive, same ticks, only the denominator changed** — `rsi-oversold`, its 1,400 recorded BULLISH ticks (`directiveoutcome`, maxScore 140 in all 33 protocols that use it): average **66.1%** over 140 vs **10.2%** over 910; ticks at or above 60%: **736 of 1,400** vs **0 of 1,400**. Max 100% vs ~15%. ⚠️ **SECOND FINDING — the binding constraint is not only dilution, and it is worse than dilution.** A one-directive protocol is effectively BINARY: NO_DATA, or 60%+. On a neutral tick it writes **no score at all** — EURUSD `ema-structure` read neutral at 35/100 and XAGUSD `rsi-oversold` at 58/140 (RSI 31.3, a bullish setup forming), both producing `hasDirectionalEvidence: false`, `signalPct: 0`, and **0 rows** in `score` and `score_snapshot`. So the misleading low percentages come from MULTI-directive protocols, where some directive usually reads directional and unblocks a score that is then divided by the full configured capacity. **Measured fleet-wide over 30 days of stored breakdowns: 29,353 of 141,675 directive readings (20.7%) scored exactly 0, and 99.4% of those carried `maxScore >= 50` — capacity in the denominator that the numerator cannot reach. `social-buzz` and `earnings-momentum` have scored 0 on 100% of their readings, `session-open-effect` on 92.6%, `analyst-adjustments` on 92.9%.** Filed as **#1122**.',
      measuredAt: '2026-10-15',
      source:
        'This repo — live `GET /api/scoring/gated/:symbol?protocol=…`, `score.breakdown` via JSON_TABLE (141,675 readings), `directiveoutcome` (1,400-row query), `protocol_directive_entry` capacity sums, `protocol_score_status`, `strategy_signal_queue` and `trade` (magic 234143). Built objects: protocols `probe-1dir-v1` + `probe-1dir-rsi`, bots magic 234143 + 234144.',
    },
    decision:
      'SUPPORTED — leave the probe in place and let it run. The lever is DIRECTIVE COUNT (denominator), not the directives themselves; a single directive reaches 60% on 100% of its bullish ticks. ⚠️ **What this does NOT license:** lowering `capacityMaxTotal` by hand-editing incumbents. The probe is a NEW protocol, never an edit of one with performance history (`maths-change-requires-ab`). ⚠️ **What it means for the next step:** because the probe is binary, a protocol sized for frequent trading wants a directive that reads DIRECTIONAL often — measured bullish ticks per candidate: `ema-structure` 4,563 (cleanest, always 60/100), `rsi-oversold` 1,400 (strongest, 43–100%), `session-open-effect` 441 (84.6% avg), and `multi-timeframe-trend` 1,068 with a ceiling of **12.5%** — a trap that would produce zero signals however permissive the bot.',
    area: 'scoring',
    issue: 915,
  },

  // ── The owner's 2026-10-14 reading of the P&L ──────────────────────────────────────────────────
  {
    id: 'the-loss-is-concentrated-in-gold-ex-gold-is-break-even',
    raisedAt: '2026-10-14',
    statement:
      'The app’s realised loss is concentrated in gold and silver, and excluding them the strategy is approximately break-even rather than losing.',
    predictedDirection:
      'P&L excluding `XAUUSD`/`XAGUSD` is a small number near zero, while the gold/silver bucket carries the large negative.',
    measure: '`SUM(pnl)` per bucket, on `trade` where `status=closed AND pnlInvalid=0`',
    unit: 'account currency (GBP), and average per trade',
    window: 'All valid closed trades, 2026-08-12 → 2026-10-14 (333 trades).',
    status: 'supported',
    evidence: {
      basis: 'measurement',
      n: 333,
      result:
        'CONFIRMED, more strongly than stated. **GOLD/SILVER: 61 trades (18% of the count), £−1,079.19 — 93% of the total loss of £−1,157.87.** Everything else: 272 trades, **£−78.68**, i.e. **£−0.29 per trade** — break-even. ⚠️ The mechanism is sizing, not entry: one XAUUSD MINIMUM lot (0.01) risks £87.98, which was 82% of a 15% portfolio cap (measured 2026-10-13, MetaQuotes-Demo equity £718.65). The broker will not size below that, so gold cannot be risked proportionally on a small account.',
      measuredAt: '2026-10-14',
      source: '`trade` table — `GROUP BY CASE WHEN symbol IN (\'XAUUSD\',\'XAGUSD\')`',
    },
    falsification:
      'Re-run the two-bucket split. If the ex-gold bucket is materially negative — say worse than −£5/trade — this is refuted and the loss is systemic rather than concentrated. ⚠️ Re-measure rather than carry the figure forward: it moves with every closed trade, and the sample is small.',
    decision:
      'CONFIRMED as the owner’s reading, and it changes what "is it working?" means: **the honest test is ex-gold.** Gold must be judged separately — it is a position-sizing question (one lot is too big for this account), not a scoring question. ⚠️ NOT acted on here: reducing gold size or disabling gold bots is a RISK change, and it is the owner’s call. ⚠️ Do not delete the gold result to make the book look better — the concentration IS the finding.',
    area: 'trading',
  },
  {
    id: 'profit-comes-from-long-holds-not-entry-precision',
    raisedAt: '2026-10-14',
    statement:
      'Winners realise their gain many hours or a day after entry, so the outcome is driven by how long a position is held rather than by how precise the entry was.',
    predictedDirection:
      'P&L rises monotonically with hold duration, so the longest-held bucket is the most profitable and the shortest is the least.',
    measure: '`SUM(pnl)` and win rate bucketed by `TIMESTAMPDIFF(MINUTE, openedAt, closedAt)`',
    unit: 'account currency (GBP) per bucket, and win rate in %',
    window: 'All valid closed trades, 2026-08-12 → 2026-10-14. Both all-trades and ex-gold.',
    status: 'refuted',
    evidence: {
      basis: 'measurement',
      n: 333,
      result:
        'REFUTED as stated, PARTLY right in the middle of the range. Buckets (all trades): <1h £−36.95 · **1–6h £−1,014.43** · **6–24h £+25.54** · >24h £−132.03. So **only the 6–24h band is profitable**, and "the next day" is NEGATIVE — the relationship is not monotonic: it rises to a peak at 6–24h and then falls. ⚠️ **Ex-gold, and this is the decisive part: win rates are 40.9% / 56.8% / 46.2% / 37.0% — all coin-flip, and the 56.8% bucket STILL LOSES (£−45.97).** A bucket that wins most of its trades and loses money is a payoff problem, not an entry or a holding problem: ex-gold avg win **£2.46** vs avg loss **£−2.74** (ratio **1.11**), needing a **52.6%** win rate to break even against an actual **47.1%** — a gap of 5.5 points. All-trades the ratio is **2.2** because gold’s losses are large.',
      measuredAt: '2026-10-14',
      source: '`trade` table — hold-duration buckets + `AVG(CASE WHEN pnl>0 …)` / `AVG(CASE WHEN pnl<0 …)`',
    },
    falsification:
      'Re-bucket by hold duration and read win rate beside P&L. If any bucket shows a materially higher win rate AND a positive P&L, duration is doing real work. ⚠️ The two numbers must be read TOGETHER — this refutation is only visible because the 56.8% bucket is the one that loses.',
    decision:
      'DIRECTION OF THE FIX MOVES TO THE EXIT AND THE SIZE, NOT THE ENTRY. ⚠️ This is consistent with what the repo already recorded independently — `PRIMARY-GOALS.md` cites #916 (*"winners exit at a third of their target while losers reach the stop"*) and #917 (*"its winner closed at 14% of target"*), which is the same payoff-ratio defect seen from the trade side. ⚠️ NOT a scoring finding: entry precision is ~47% at every duration, so tuning directives cannot lift the win rate to 52.6% on its own — the payoff ratio is the cheaper lever, and it is 2.2× worse than it needs to be because of gold sizing.',
    area: 'trading',
  },
  {
    id: 'most-of-the-loss-is-the-a-b-test-not-the-live-strategy',
    raisedAt: '2026-10-14',
    statement:
      'The book’s realised loss comes overwhelmingly from the A/B test accounts rather than from the live bots, so a whole-book P&L figure describes the measurement instrument and not the strategy.',
    predictedDirection:
      'Splitting closed trades by `strategy` shows the `AB-%` rows carrying a large negative while the non-AB live rows sit near zero per trade.',
    measure: '`SUM(pnl)` and `AVG(pnl)` grouped into A/B test, non-A/B copies, and live bots',
    unit: 'account currency (GBP), total and per trade, with win rate in %',
    window: 'All valid closed trades, 2026-08-12 → 2026-10-14 (333 trades).',
    status: 'supported',
    evidence: {
      basis: 'measurement',
      n: 333,
      result:
        'CONFIRMED, and far more extreme than expected. **A/B TEST: 23 trades (7% of the count) at £−929.60 — 80% of the total loss of £−1,157.87**, win rate **17.4%**. Protocol copies (non-A/B): 9 trades, £−122.72. **LIVE BOTS: 301 trades, £−105.55 — £−0.35 per trade at a 47.5% win rate, i.e. break-even.** ⇒ **91% of the loss is test instrumentation.** ⚠️ The arms are also un-sized: worst single A/B trade **£−322.67** (~45% of a £718.65 demo account), and the `AB-A #929 measurable run` average loss **£−87.49** matches ONE `XAUUSD` minimum lot risk (£87.98) — so a stop-out is large by construction and **the arms are not measuring the protocol difference they exist to measure.**',
      measuredAt: '2026-10-14',
      source: '`trade` table — `GROUP BY CASE WHEN strategy LIKE \'AB-%\' …`',
    },
    falsification:
      'Re-split by `strategy`. If the `AB-%` rows are a small share of the loss, this is refuted and the live strategy is genuinely losing. ⚠️ Check the grouping before trusting it: a row whose `strategy` is NULL or renamed silently moves between buckets.',
    decision:
      'REPORTING IS CONTAMINATED AND THE EXPERIMENT IS COMPROMISED — both are #1120. ⚠️ Consequences that were acted on: the owner’s own reading (*"if we take gold out of the equation I think we break even"*) is CORRECT but the cause is narrower than gold — it is the A/B accounts, and gold is where they were pointed. **Any "is the strategy working?" figure must state whether it includes `AB-%` rows**, or it measures the instrument. ⚠️ NOT fixed here: applying the risk gate to A/B arms changes what they do (owner call), and an exempt instrument is measuring a different game from the one the bots play.',
    area: 'trading',
    issue: 1120,
  },
];

export default THEORIES;
