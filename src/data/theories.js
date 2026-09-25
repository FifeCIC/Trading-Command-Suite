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
      'Do NOT act on this by editing the maths. `slPct`/`baseSize` are maths (SETTLED-DECISIONS row 21) and A/B cannot report yet (#929). What this changes is PRIORITY: the largest lever is gold exposure, and 48 of the 59 gold trades are not attributable to a bot at all — that is the #949 attribution defect, not a strategy result. Attribution is therefore a prerequisite for deciding anything about gold, because until it is fixed the manual and bot paths cannot be told apart. The MAGNITUDE is small (a £91 net on a demo book); the SHAPE is the finding.',
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
];

export default THEORIES;
