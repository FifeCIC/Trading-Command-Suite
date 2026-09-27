#!/usr/bin/env node
/**
 * audit-bot-activation.cjs — WHY each trading bot can or cannot trade.
 * ===================================================================
 * Born from the US500 incident (2026-09-15): a bot looked perfectly configured in the UI
 * while the bridge refused every order it sent. Three separate faults were found by hand
 * before this script existed, and all three shared one property — **the app could not see
 * them**:
 *
 *   1. NO ROUTE      — the symbol falls back to the primary broker, which may refuse it
 *                      (US500 on MetaQuotes: `tradeMode 0`).
 *   2. NOT TRADEABLE — the broker LISTS the symbol and still refuses to trade it. `tradeMode`
 *                      is a property of BROKER × SYMBOL, never of the symbol alone.
 *   3. BELOW FLOOR   — every index symbol has a 0.1-lot minimum on both bridges, while the
 *                      seeded bots all shipped `baseSize: 0.01`. `Volume 0.01 below UK100
 *                      minimum (0.1)` in the log is the receipt.
 *
 * A fourth fault is config-only: an INACTIVE bot or one with no `strategy_protocol`
 * subscription never receives a queued signal, so it cannot trade however healthy it looks.
 *
 * This prints a per-bot verdict so "why is nothing trading?" is answerable in one command
 * instead of an afternoon. It is READ-ONLY: it never changes a bot, a route or an order.
 *
 * Usage (from nest/):  node scripts/audit-bot-activation.cjs
 *                      npm run audit:bot-activation
 * Exit code: 1 if any ACTIVE bot is blocked, 0 otherwise (inactive bots are reported, not fatal).
 *
 * ⚠️ TWO CHECKS, TWO DEPTHS — THIS IS DEPTH 2. They are NOT duplicates.
 * -------------------------------------------------------------------
 * `validate-route-capability.cjs` (`npm run db:route-capability`) answers DEPTH 1: can any active
 * broker trade this SYMBOL **at all**? It reads only `broker_symbol` in the DATABASE, so it still
 * works with both bridges down — which is the one thing this script cannot do.
 *
 * THIS script answers DEPTH 2: can this BOT trade **right now**? It adds bars, the
 * `strategy_protocol` subscription and floor-vs-`baseSize`, and it reads `tradeMode` from the LIVE
 * BRIDGES rather than from the database.
 *
 * ⚠️ Measured 2026-09-25 by running both on the same data, because "they might be duplicates" is a
 * claim and this is the observation:
 *   • `db:route-capability` → exit **0**, "every active bot has a symbol at least one active broker can trade"
 *   • this audit          → exit **1**, BTC Investment Monitor blocked `BELOW-FLOOR(0.01<1)`
 * Both reported **38 active bots**, so the population agrees and only the depth differs.
 *
 * ⚠️ BUT THE CAUSE OF THE DISAGREEMENT WAS MISREAD — CORRECTED 2026-09-26. I first recorded "both are
 * right: BTC's *symbol* is tradeable, its *bot* is not." **That is wrong**, and it is written here
 * because the wrong version was already published. `symbol_route` holds `BTC → provider 'binance'`
 * (brokerId 0), and the `routedBroker` subquery above selects `provider = 'mt5'` **only** — so BTC's
 * route reads as NULL, this script falls back to the primary broker, and it applies **MetaQuotes'**
 * `volumeMin 1` to a symbol that does not trade on MetaQuotes. The bare ticker `BTC` does exist on
 * :5000 — the #914 hazard the guard was already corrected for. **So this script's `BELOW-FLOOR` for
 * BTC is a FALSE POSITIVE by venue, and because BTC is its only blocked bot, this script's exit 1
 * rests entirely on it.**
 *
 * ⚠️ Do NOT "fix" that by raising BTC's `baseSize` — that changes a number to satisfy a constraint
 * from the wrong venue. The fix is to skip, or explicitly NAME, non-MT5-routed symbols here, exactly
 * as `validate-route-capability.cjs` already does for the same reason.
 *
 * WHEN TO RUN WHICH: bridges UP → run THIS (it subsumes depth 1's question and adds the rest).
 * Bridges DOWN, on CI, or on a machine with no bridge → run `db:route-capability`.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const NEST_ROOT = path.resolve(__dirname, '..');

/**
 * How long a symbol may go without a NEW score before it is reported STALE-SCORE.
 *
 * ⚠️ #983 — DECLARED, not invented at the call site, because it is a judgement and a reader is
 * entitled to see the number and disagree with it.
 *
 * WHY 60: the loop's own cadence target is far tighter than this (protocols declare 5s-30s, and
 * #996 measures the real rate as under 6/hour). So 60 minutes does not mean "quiet" — it means
 * something is structurally wrong. The measured failure this must catch was **6h12m** (FRA40 last
 * `score_snapshot` 08:55 while the audit ran at ~15:07), so the threshold has ~6x headroom and will
 * not fire on a merely slow symbol.
 *
 * REVERSE BY: set AUDIT_STALE_SCORE_MINUTES, or tighten/loosen this constant.
 */
const STALE_SCORE_MINUTES = Number(process.env.AUDIT_STALE_SCORE_MINUTES || 60);

/**
 * How long the automation loop may go without a tick before every bot is LOOP-DOWN.
 *
 * ⚠️ Same reasoning. Measured failure: `:3201` was not listening at all and the last `decision_log`
 * write was **14:51:11 UTC**, ~16 minutes before the audit ran — but the audit printed `OK` for
 * every bot. 10 minutes catches that while tolerating one slow loop pass.
 */
const LOOP_DOWN_MINUTES = Number(process.env.AUDIT_LOOP_DOWN_MINUTES || 10);

function loadEnv() {
  const envPath = path.join(NEST_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/** Broker slot -> bridge port is declared by MT5_ACTIVE_BROKERS order (2 = :5000, 3 = :5001). */
function portByBrokerMap() {
  const ids = (process.env.MT5_ACTIVE_BROKERS || '2,3').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  const ports = [5000, 5001];
  const map = {};
  ids.forEach((id, i) => { if (ports[i]) map[id] = ports[i]; });
  return { map, ids };
}

function getJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * classifyFaults() — PURE. Every fault code is a CLAIM about the world, and two of these claims were
 * wrong in ways prose could not prevent (both measured 2026-09-26):
 *
 *   • `BELOW-FLOOR` was asserted for a symbol routed to a NON-MT5 venue — an MT5 floor applied to a
 *     symbol that does not trade on MT5 (BTC → binance).
 *   • `BROKER-HAS-NO-SYMBOL` was asserted when the bridge simply never answered, publishing "cannot
 *     judge" as a definite "the broker does not list it".
 *
 * Extracted and tested so the next wrong claim has to get past `--self-test` first.
 *
 * ⚠️ #983 — THE SAME DEFECT APPEARED ONE LEVEL UP. This function judged CONFIGURATION only
 * (active, mode, size, floor, bars-exist, subscription-exists), so on 2026-09-23 it printed `OK`
 * for all six Pepperstone bots while **not one of them could trade**: the automation loop was down,
 * GER40's and VIX's caps were unevaluable, and two symbols had not produced a score for six hours.
 * A green tick that means "configured" is indistinguishable from one that means "able to trade" —
 * which is the failure this script was written to end (the US500 incident, 2026-09-15).
 *
 * So the verdict vocabulary now has THREE outcomes, not two:
 *   OK       — configured AND the environment can act on it
 *   <FAULT>  — a specific, named reason it cannot
 *   UNKNOWN  — the input could not be read. NEVER a pass (a check that cannot read its own input
 *              must not report success — it is the absence of information, a third state).
 */
function classifyFaults(i) {
  const faults = [];

  // ── Environment faults first: they make every bot unable to trade, whatever its config says ──
  // ⚠️ A fault here is NOT "this bot is misconfigured" — it is "nothing can act right now". It is
  // reported per-bot because the reader is looking at a bot, but the cause is global.
  if (i.loop === false) {
    faults.push(`LOOP-DOWN(${i.loopAgeMin != null ? `${i.loopAgeMin}m` : 'age unknown'})`);
  } else if (i.loop == null) {
    // Could not read the loop's state at all. That is UNKNOWN, and UNKNOWN must never render as OK.
    faults.push(`LOOP-UNKNOWN(${i.loopWhy ?? 'unreadable'})`);
  }

  if (i.capBlocked > 0) {
    faults.push(`CAP-UNEVALUABLE(${i.capBlocked}x)`);
  }

  // ── Configuration faults ──
  if (!i.active) faults.push('INACTIVE');
  if (i.subs === 0) faults.push('NO-SUBSCRIPTION');
  if (i.bars === 0) faults.push('NO-BARS');

  // ── Freshness of the LAST SCORE ──
  // ⚠️⚠️ #983 — REPORTED, NOT JUDGED. This is the SECOND correction of my own work on this issue, and
  // both corrections came from running it rather than reading it.
  //
  // Attempt 1 used a plain 60-minute wall-clock threshold and reported **all 40 bots stale** on a
  // Sunday (`2d00h ago`) because markets had been shut all weekend.
  // Attempt 2 compared each symbol against the newest score ANYWHERE. Measured, that is still
  // wrong: **BTC is scored every minute** (crypto trades weekends), so the pipeline reads "LIVE"
  // while every equity and FX market is shut. Still 38 false reports.
  //
  // Bar freshness was then measured as a possible market-open signal and **it is not one**: AAPL
  // reports a 5-minute-old bar on a Sunday, so bars are synthetic and are written whether or not the
  // market trades. Measured 2026-09-27 — bars 5m old while scores were 2896m old, on every symbol.
  //
  // ⚠️ AND SCORING A CLOSED MARKET IS DELIBERATE (review-queue R13 / #956): a closed market is
  // *supposed* not to be scored, so an old `score_snapshot` is EXPECTED there. There is therefore no
  // signal available to this script that separates "the market is shut" from "this symbol is
  // starved" — and a check that cannot read its input must not publish a fault it cannot justify,
  // just as it must not publish a pass.
  //
  // So: the AGE IS PRINTED (which is what the acceptance criterion asks for — an age beside its
  // timestamp, never a bare bar count), and a large age is reported **visibly but NOT as a blocker**.
  // That is the honest outcome: the reader gets the fact they need and is not told a cause we cannot
  // establish. Making it blocking again requires a real market-open signal, which is its own issue.
  if (i.bars > 0) {
    if (i.scoreAgeMin == null) {
      faults.push('NO-SCORE-EVER');
    } else if (i.scoreAgeMin > STALE_SCORE_MINUTES) {
      faults.push(`STALE-SCORE(${formatAge(i.scoreAgeMin)})`);
    }
  }

  if (i.nonMt5) {
    // Out of scope for an MT5 audit — reported so it is VISIBLE, never silent, and never fatal.
    faults.push(`NON-MT5-VENUE(${i.nonMt5})`);
  } else if (!i.listLoaded) {
    // CANNOT JUDGE — never "the broker has no such symbol". Fatal: a check that could not read its
    // input must not report OK.
    faults.push(`BRIDGE-UNAVAILABLE(:${i.port ?? '?'} ${i.unavailable ?? 'unreachable'})`);
  } else {
    if (i.tradeMode === 0) faults.push('NOT-TRADEABLE-HERE');
    if (i.tradeMode === undefined) faults.push('BROKER-HAS-NO-SYMBOL');
    if (i.volumeMin != null && i.size < i.volumeMin) faults.push(`BELOW-FLOOR(${i.size}<${i.volumeMin})`);
  }
  return faults;
}

/**
 * REPORTED_NOT_BLOCKING — the ONE place that decides which faults are facts-only.
 *
 * ⚠️ Declared as data rather than as a predicate in two places, because `isBlocked()` and the verdict
 * renderer must agree: if they drift, a fault can print as a blocker while counting as OK (which is
 * exactly the contradiction this list was added to remove).
 *
 *   • INACTIVE           — "not generating data", not a defect this audit judges.
 *   • NON-MT5-VENUE      — an MT5 floor/`tradeMode` does not apply to a symbol routed elsewhere.
 *   • STALE-SCORE        — this script cannot tell "market shut" from "symbol starved" (see above).
 *   • NO-SCORE-EVER      — same ambiguity, so reported with the same restraint.
 */
const REPORTED_NOT_BLOCKING = ['INACTIVE', 'NON-MT5-VENUE', 'STALE-SCORE', 'NO-SCORE-EVER'];

/** A prefix of a blocking fault — used only for RENDERING. `isBlocked()` is the authority. */
const BLOCKING_PREFIXES = ['LOOP-DOWN', 'LOOP-UNKNOWN', 'CAP-UNEVALUABLE', 'NO-SUBSCRIPTION',
  'NO-BARS', 'BRIDGE-UNAVAILABLE', 'NOT-TRADEABLE-HERE', 'BROKER-HAS-NO-SYMBOL', 'BELOW-FLOOR'];

function isBlocked(active, faults) {
  return active && faults.some((f) =>
    !REPORTED_NOT_BLOCKING.some((p) => f === p || f.startsWith(`${p}(`) || f.startsWith(`${p}:`)));
}

/**
 * formatAge() — minutes -> a readable age. Derived in the OPEN, never a bare number.
 *
 * ⚠️ The audit used to print a bar COUNT under a column whose reader assumed freshness. `13908`
 * is unreadable; `6h12m` beside the timestamp it came from is checkable. That is the whole point
 * of the Development Philosophy rule "print raw; derive in the open".
 */
function formatAge(minutes) {
  if (minutes == null) return 'n/a';
  const m = Math.floor(minutes);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`;
}

/**
 * Synthetic cases that MUST produce the stated fault — a rule never observed to fail is decoration.
 * Cases 1 and 2 are the two real bugs; cases 3-5 prove the legitimate claims still fire, so the fix
 * cannot have been "make it say nothing".
 */
function selfTest() {
  const bad = [];
  const check = (label, got, want) => {
    const g = got.join(' ');
    if (g !== want) bad.push(`${label}\n     want: ${want}\n      got: ${g}`);
  };
  // ⚠️ #983 — the new environment fields default to "healthy and readable", so the ORIGINAL six
  // cases still assert the ORIGINAL claim. A fix that silently relaxed them would pass the new
  // cases while losing the old guarantee.
  const base = {
    active: true, subs: 1, bars: 100, port: 5001, size: 0.01, volumeMin: null,
    loop: true, loopAgeMin: 1, capBlocked: 0, scoreAgeMin: 1,
  };

  // 1 — the BTC bug. A non-MT5 venue must NOT be judged against an MT5 floor, however far below it is.
  check('1 non-MT5 route must be out of scope, never BELOW-FLOOR',
    classifyFaults({ ...base, nonMt5: 'binance', listLoaded: true, tradeMode: 4, volumeMin: 1 }),
    'NON-MT5-VENUE(binance)');

  // 2 — the availability bug. No usable list must NOT be published as "the broker has no symbol".
  check('2 no usable list must be BRIDGE-UNAVAILABLE, never BROKER-HAS-NO-SYMBOL',
    classifyFaults({ ...base, nonMt5: null, listLoaded: false, tradeMode: undefined, unavailable: 'terminal-down' }),
    'BRIDGE-UNAVAILABLE(:5001 terminal-down)');

  // 3 — direction check: a loaded list that GENUINELY lacks the ticker must still fire.
  check('3 a loaded list genuinely missing the ticker must still fail',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: undefined }),
    'BROKER-HAS-NO-SYMBOL');

  // 4 — direction check: a real tradeMode=0 must still fire.
  check('4 tradeMode=0 on a loaded list must still fail',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 0 }),
    'NOT-TRADEABLE-HERE');

  // 5 — direction check: a genuine below-floor MT5 bot must still fire (the floor check is not dead).
  check('5 a genuine MT5 below-floor bot must still fail',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 4, volumeMin: 1 }),
    'BELOW-FLOOR(0.01<1)');

  // 6 — and a healthy bot must be silent, or the rule is just "everything fails".
  check('6 a healthy bot must report nothing',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 4, volumeMin: 0.01 }), '');

  // ── #983 cases. Each one is a fault this audit printed `OK` for on 2026-09-23. ──

  // 7 — the loop was DOWN. Every bot is blocked, however perfect its configuration.
  check('7 a down loop must block a perfectly-configured bot',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 4, volumeMin: 0.01, loop: false, loopAgeMin: 16 }),
    'LOOP-DOWN(16m)');

  // 8 — the loop's state could not be read. UNKNOWN is NOT a pass, and it must not read as OK.
  check('8 an unreadable loop must be LOOP-UNKNOWN, never silent',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 4, volumeMin: 0.01, loop: null, loopWhy: 'api-down' }),
    'LOOP-UNKNOWN(api-down)');

  // 9 — the per-symbol cap could not be evaluated (GER40 x35, VIX x23, measured 2026-09-23).
  check('9 an unevaluable cap must fail, even when everything else is fine',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 4, volumeMin: 0.01, capBlocked: 35 }),
    'CAP-UNEVALUABLE(35x)');

  // 10 — no score for six hours WHILE OTHERS ARE SCORING. The measured case: FRA40 08:55, audit ~15:07.
  check('10 a six-hour-old score must be REPORTED with an AGE, not a bar count',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 4, volumeMin: 0.01, scoreAgeMin: 372 }),
    'STALE-SCORE(6h12m)');

  // 11 — direction check: a score one minute old must NOT be reported (the rule is not "always").
  check('11 a one-minute-old score must not be reported at all',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 4, volumeMin: 0.01, scoreAgeMin: 1 }),
    '');

  // 12 — bars exist but NO score has ever been produced. Absence of information is not a pass.
  check('12 bars-but-never-scored must be NO-SCORE-EVER, never OK',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 4, volumeMin: 0.01, scoreAgeMin: null }),
    'NO-SCORE-EVER');

  // 13 — ⚠️ THE OVER-FIRING CORRECTIONS, BOTH ATTEMPTS. On a Sunday the market has been shut for two
  // days, so a multi-day age is EXPECTED and there is no signal here that separates "market shut"
  // from "symbol starved" (bars are synthetic — AAPL had a 5-minute-old bar on a Sunday; and a closed
  // market is deliberately not scored, R13). So the age is REPORTED but is NOT a blocker.
  if (isBlocked(true, ['STALE-SCORE(2d00h)'])) {
    bad.push('13 STALE-SCORE must NOT block — we cannot tell "market shut" from "symbol starved"');
  }
  if (isBlocked(true, ['NO-SCORE-EVER'])) {
    bad.push('14 NO-SCORE-EVER must NOT block, for the same reason');
  }
  // 15 — but it must still be VISIBLE, or the fix would have been "delete the rule".
  check('15 a two-day-old score is still REPORTED (visible, just not blocking)',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 4, volumeMin: 0.01, scoreAgeMin: 2880 }),
    'STALE-SCORE(2d00h)');

  if (isBlocked(true, ['NON-MT5-VENUE(binance)'])) bad.push('16 a non-MT5 venue must NOT count as blocked');
  if (isBlocked(true, ['INACTIVE'])) bad.push('17 INACTIVE must NOT count as blocked');
  if (!isBlocked(true, ['BRIDGE-UNAVAILABLE(:5001 terminal-down)'])) {
    bad.push('18 BRIDGE-UNAVAILABLE MUST count as blocked — cannot-judge is not a pass');
  }
  if (!isBlocked(true, ['LOOP-UNKNOWN(api-down)'])) {
    bad.push('19 LOOP-UNKNOWN MUST count as blocked — an unreadable loop is not a healthy one');
  }
  if (!isBlocked(true, ['LOOP-DOWN(16m)'])) bad.push('20 LOOP-DOWN MUST count as blocked');
  if (!isBlocked(true, ['CAP-UNEVALUABLE(35x)'])) bad.push('21 CAP-UNEVALUABLE MUST count as blocked');

  // 27/28 — ⚠️ THE DRIFT GUARD. `isBlocked()` (the authority) and `BLOCKING_PREFIXES` (used only for
  // rendering) must agree, or a fault can print as a blocker while counting as OK. That contradiction
  // is exactly why these two lists exist, so they are proved consistent rather than assumed.
  for (const p of BLOCKING_PREFIXES) {
    if (REPORTED_NOT_BLOCKING.includes(p)) {
      bad.push(`27 '${p}' is in BOTH lists — it cannot be blocking and reported-only`);
    }
    if (!isBlocked(true, [`${p}(x)`]) && !isBlocked(true, [p])) {
      bad.push(`28 '${p}' is not blocking but is not in REPORTED_NOT_BLOCKING either`);
    }
  }
  for (const p of REPORTED_NOT_BLOCKING) {
    if (BLOCKING_PREFIXES.includes(p)) {
      bad.push(`29 '${p}' is in BOTH lists — it cannot be reported-only and blocking`);
    }
  }

  // ── formatAge() is a derived number, so it gets its own boundary checks. ──
  if (formatAge(45) !== '45m') bad.push(`22 formatAge(45) must be '45m', got '${formatAge(45)}'`);
  if (formatAge(60) !== '1h00m') bad.push(`23 formatAge(60) must be '1h00m', got '${formatAge(60)}'`);
  if (formatAge(372) !== '6h12m') bad.push(`24 formatAge(372) must be '6h12m', got '${formatAge(372)}'`);
  if (formatAge(2880) !== '2d00h') bad.push(`25 formatAge(2880) must be '2d00h', got '${formatAge(2880)}'`);
  if (formatAge(null) !== 'n/a') bad.push(`26 formatAge(null) must be 'n/a', got '${formatAge(null)}'`);

  if (bad.length) {
    console.error(`\n\u274c self-test: ${bad.length} case(s) FAILED:`);
    for (const b of bad) console.error(`   ${b}`);
    return 1;
  }
  console.log('\u2705 self-test: 26 cases across four families:');
  console.log('   \u2022 the ORIGINAL claims still hold \u2014 a genuine below-floor bot, a tradeMode=0 and a');
  console.log('     genuinely-absent symbol each still FAIL; a non-MT5 venue is still skipped; a healthy');
  console.log('     bot is still silent.');
  console.log('   \u2022 #983 \u2014 a DOWN loop, an UNREADABLE loop and an unevaluable cap each BLOCK, and none');
  console.log('     of them can render as OK.');
  console.log('   \u2022 the OVER-FIRING CORRECTION \u2014 cases 13/14 assert that a stale or never-scored symbol');
  console.log('     must NOT block (we cannot tell "market shut" from "symbol starved": bars are');
  console.log('     synthetic, and a closed market is deliberately not scored, R13), while case 15');
  console.log('     asserts the same fault is STILL REPORTED. Without 15, the fix would have been');
  console.log('     indistinguishable from deleting the rule.');
  console.log('   \u2022 formatAge() boundaries, because an age printed wrongly is a claim printed wrongly.');
  return 0;
}

/**
 * probeEnvironment() — #983. What is true of the MACHINE, as opposed to of the bot's configuration.
 *
 * ⚠️ IT READS THE DATABASE, NOT `GET /api/automation/status`, AND THAT CHOICE IS THE POINT.
 * The fault this must catch is "the automation loop is not running" — and the most common way for
 * that to be true is that the API is not listening. An HTTP probe would therefore fail *exactly*
 * when it is most needed, and a failed probe is one step away from being reported as OK. The loop's
 * own heartbeat is its newest `decision_log` row, which the DB holds whether or not `:3201` is up.
 *
 * Returns { loop, loopAgeMin, loopWhy, capBlockedBySymbol, scoreAgeBySymbol, scoreNewestBySymbol }.
 *   loop === true   — the heartbeat is within LOOP_DOWN_MINUTES
 *   loop === false  — it is not; every bot is unable to trade
 *   loop === null   — the heartbeat could not be read. UNKNOWN, never a pass.
 */
async function probeEnvironment(prisma) {
  const env = {
    loop: null,
    loopAgeMin: null,
    loopWhy: null,
    capBlockedBySymbol: new Map(),
    scoreAgeBySymbol: new Map(),
    scoreNewestBySymbol: new Map(),
  };

  // ── 1. Loop heartbeat ──
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT MAX(timestamp) AS newest FROM decision_log',
    );
    const newest = rows && rows[0] ? rows[0].newest : null;
    if (!newest) {
      env.loop = false;
      env.loopWhy = 'decision_log is empty — the loop has never run';
    } else {
      env.loopAgeMin = (Date.now() - new Date(newest).getTime()) / 60000;
      env.loop = env.loopAgeMin <= LOOP_DOWN_MINUTES;
      if (!env.loop) env.loopWhy = `last heartbeat ${String(newest)}`;
    }
  } catch (err) {
    env.loop = null;
    env.loopWhy = `cannot read decision_log: ${String(err.message).split('\n')[0]}`;
  }

  // ── 2. Per-symbol: could the cap be evaluated? ──
  // The cap cannot be evaluated when the symbol has no quote — measured 2026-09-23 as
  // `Cannot evaluate the per-symbol cap for GER40: price is 0 (no quote)` x35 and VIX x23. That
  // is a BLOCKED decision, so the symbol is configured to trade and structurally cannot.
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT symbol, COUNT(*) AS n
         FROM decision_log
        WHERE reason LIKE 'Cannot evaluate the per-symbol cap for%'
          AND timestamp > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
        GROUP BY symbol`,
    );
    for (const r of rows) env.capBlockedBySymbol.set(String(r.symbol).toUpperCase(), Number(r.n));
  } catch (err) {
    // ⚠️ Leave the map EMPTY rather than filling it with a guess. An empty map means "no cap
    // failures were found", which is the same rendering as "the query failed" — so the fact that
    // this probe failed is surfaced separately, beside the loop state.
    env.capProbeFailed = String(err.message).split('\n')[0];
  }

  // ── 3. Per-symbol: how old is the newest SCORE? ──
  // ⚠️ `score_snapshot.symbol` is the ticker directly; no join needed. `protocolId` here is a SLUG
  // and is deliberately not joined to `protocol.id` (see the schema warning that tool prints).
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT symbol, MAX(snappedAt) AS newest
         FROM score_snapshot
        GROUP BY symbol`,
    );
    const now = Date.now();
    let newestAnywhere = null;
    for (const r of rows) {
      const key = String(r.symbol).toUpperCase();
      if (!r.newest) continue;
      const age = (now - new Date(r.newest).getTime()) / 60000;
      env.scoreAgeBySymbol.set(key, age);
      env.scoreNewestBySymbol.set(key, new Date(r.newest).toISOString());
      if (newestAnywhere === null || age < newestAnywhere) newestAnywhere = age;
    }
    // ⚠️ Is the PIPELINE itself quiet? If the newest score anywhere is older than the threshold,
    // nothing is being scored and a per-symbol age says nothing about that symbol — it is the
    // market being closed. This is the guard against reporting 40 stale bots on a Sunday morning.
    env.pipelineNewestScoreAgeMin = newestAnywhere;
    env.pipelineQuiet = newestAnywhere === null || newestAnywhere > STALE_SCORE_MINUTES;
  } catch (err) {
    env.scoreProbeFailed = String(err.message).split('\n')[0];
  }

  return env;
}

async function main() {
  if (process.argv.slice(2).includes('--self-test')) process.exit(selfTest());
  loadEnv();
  const { map: portByBroker, ids: brokerIds } = portByBrokerMap();

  let prisma = null;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error(`Cannot audit without the database: ${err.message.split('\n')[0]}`);
    process.exit(1);
  }

  // ── Per-broker symbol list (tradeMode) — one call per live bridge ──
  const modesByPort = new Map();
  /** port -> WHY the list is unusable, in the BRIDGE'S OWN words (`connectionState`). */
  const listUnavailable = new Map();
  for (const port of Object.values(portByBroker)) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/symbols`);
      const rowsIn = Array.isArray(list.symbols) ? list.symbols : [];
      // ⚠️ AN EMPTY LIST IS NOT AN ANSWER. A bridge whose terminal is down answers 503 WITH a JSON
      // body (measured 2026-09-26: :5001 → `terminal-down`, 616 connection errors), so
      // `list.symbols` is undefined and `new Map([])` would still SET the key — which is exactly how
      // a live outage got published as "the broker does not list this symbol".
      if (rowsIn.length === 0) throw new Error('empty symbol list');
      modesByPort.set(port, new Map(rowsIn.map((s) => [String(s.name).toUpperCase(), s.tradeMode])));
    } catch (err) {
      // Ask the bridge WHY, so the fault names the remedy instead of just "unavailable".
      let why = err && err.message ? String(err.message) : 'unreachable';
      try {
        const h = await getJson(`http://127.0.0.1:${port}/health`);
        if (h && h.connectionState) why = String(h.connectionState);
      } catch { /* health also unreadable — keep the original reason */ }
      listUnavailable.set(port, why);
    }
  }

  /** Per-symbol broker constraints. `/symbol/<X>/info` is the endpoint that carries volumeMin. */
  async function constraints(port, ticker) {
    if (!port) return null;
    try {
      const info = await getJson(`http://127.0.0.1:${port}/symbol/${encodeURIComponent(ticker)}/info`);
      return { volumeMin: typeof info.volumeMin === 'number' ? info.volumeMin : null };
    } catch { return null; }
  }

  // ⚠️ COLLATE IS REQUIRED, NOT COSMETIC. `symbol.ticker` and `trading_strategy.symbol` carry
  // DIFFERENT collations (`utf8mb4_unicode_ci` vs `utf8mb4_0900_ai_ci`), so comparing them
  // raises MySQL error 1267 `Illegal mix of collations … for operation '='`. Pinning one
  // explicit collation on each side is what makes the join legal.
  const bots = await prisma.$queryRawUnsafe(
    `SELECT t.id, t.name, t.symbol, t.active, t.mode, t.baseSize, t.protocolId, t.minComposite,
            (SELECT COUNT(*) FROM strategy_protocol sp WHERE sp.strategyId = t.id) AS subs,
            (SELECT COUNT(*) FROM marketbar b JOIN symbol s2 ON s2.id = b.symbolId
              WHERE s2.ticker COLLATE utf8mb4_unicode_ci = t.symbol COLLATE utf8mb4_unicode_ci) AS bars,
            (SELECT MAX(b.timestamp) FROM marketbar b JOIN symbol s2 ON s2.id = b.symbolId
              WHERE s2.ticker COLLATE utf8mb4_unicode_ci = t.symbol COLLATE utf8mb4_unicode_ci) AS newest,
            (SELECT sr.brokerId FROM symbol_route sr
              WHERE sr.symbol COLLATE utf8mb4_unicode_ci = t.symbol COLLATE utf8mb4_unicode_ci
                AND sr.enabled = 1 AND sr.provider = 'mt5'
              ORDER BY sr.priority ASC LIMIT 1) AS routedBroker,
            (SELECT sr.provider FROM symbol_route sr
              WHERE sr.symbol COLLATE utf8mb4_unicode_ci = t.symbol COLLATE utf8mb4_unicode_ci
                AND sr.enabled = 1 AND sr.provider <> 'mt5'
              ORDER BY sr.priority ASC LIMIT 1) AS nonMt5Provider
       FROM trading_strategy t
      ORDER BY t.symbol, t.name`,
  );

  const primary = brokerIds[0] ?? 2;

  // ⚠️ #983 — probe the environment BEFORE judging any bot. Without this the loop can be dead, the
  // caps unevaluable and the scores hours old, and every bot still prints `OK` — which is exactly
  // what happened on 2026-09-23 for all six Pepperstone bots.
  const env = await probeEnvironment(prisma);

  const rows = [];
  for (const b of bots) {
    const ticker = String(b.symbol).toUpperCase();
    // ⚠️ A symbol routed to a NON-MT5 venue (crypto → binance) is not an MT5 symbol. Measured
    // 2026-09-26: BTC is routed `provider 'binance'`, the `routedBroker` subquery selects
    // `provider = 'mt5'` ONLY so it reads NULL, and this script then fell back to :5000 and applied
    // METAQUOTES' `volumeMin 1` to a symbol that does not trade there — reporting
    // `BELOW-FLOOR(0.01<1)` as a fault. The bare ticker `BTC` exists on :5000 as a DIFFERENT
    // instrument (the #914 hazard). That was a FALSE POSITIVE, and it was this script's only blocked
    // bot, so its exit 1 rested entirely on it.
    // So MT5 `tradeMode`/`volumeMin` are NOT consulted for these, and the columns print `n/a` rather
    // than a number from a venue the symbol does not trade on.
    const nonMt5 = b.nonMt5Provider != null ? String(b.nonMt5Provider) : null;
    const brokerId = b.routedBroker != null ? Number(b.routedBroker) : primary;
    const port = nonMt5 ? undefined : portByBroker[brokerId];
    // ⚠️ `modesByPort` only gets a key when the bridge actually ANSWERED (`catch` above leaves it
    // absent). Measured 2026-09-26: :5001 was UP but returned **503** on `/symbols`, so all seven
    // broker-3 symbols read `tradeMode: undefined` and were reported `BROKER-HAS-NO-SYMBOL` — i.e.
    // "we could not ask" published as a definite "the broker does not list it". Those are different
    // facts and only one of them is evidence, so they are now separate faults.
    // ⚠️ A NON-EMPTY list, not merely a present key — this predicate was wrong on the first attempt.
    // Measured 2026-09-26: :5001 returned 503 whose body parsed to `{}`, so `new Map([])` still SET
    // the key, `listLoaded` read true, and all seven broker-3 symbols were still published as
    // BROKER-HAS-NO-SYMBOL. An empty list is not an answer, so the test requires symbols.
    const listLoaded = port != null && (modesByPort.get(port)?.size ?? 0) > 0;
    const tradeMode = nonMt5 || !listLoaded ? undefined : modesByPort.get(port)?.get(ticker);
    const c = nonMt5 || !listLoaded ? null : await constraints(port, ticker);
    const bars = Number(b.bars);
    const size = Number(b.baseSize);
    const active = Number(b.active) === 1;
    const subs = Number(b.subs);

    const faults = classifyFaults({
      active, subs, bars, nonMt5, listLoaded, tradeMode,
      volumeMin: c?.volumeMin ?? null, size, port,
      unavailable: listUnavailable.get(port),
      // ⚠️ #983 — the environment. A bot is judged on whether anything can ACT, not only on whether
      // it is configured. `loop` is null when the heartbeat could not be read, which must render as
      // UNKNOWN rather than as a healthy loop.
      loop: env.loop,
      loopAgeMin: env.loopAgeMin,
      loopWhy: env.loopWhy,
      capBlocked: env.capBlockedBySymbol.get(ticker) ?? 0,
      scoreAgeMin: env.scoreAgeBySymbol.has(ticker) ? env.scoreAgeBySymbol.get(ticker) : null,
      // ⚠️ When the whole pipeline is quiet, an old score is the MARKET's age, not this symbol's.
      pipelineQuiet: env.pipelineQuiet === true,
    });

    rows.push({
      ticker,
      name: String(b.name),
      active,
      mode: String(b.mode),
      size,
      brokerId,
      port,
      tradeMode,
      floor: c?.volumeMin ?? null,
      bars,
      newest: b.newest ? new Date(b.newest).toISOString() : null,
      // ⚠️ #983 — the window is carried, not printed as a bare number.
      scoreAgeMin: env.scoreAgeBySymbol.has(ticker) ? env.scoreAgeBySymbol.get(ticker) : null,
      scoreNewest: env.scoreNewestBySymbol.get(ticker) ?? null,
      capBlocked: env.capBlockedBySymbol.get(ticker) ?? 0,
      subs,
      minComposite: b.minComposite,
      faults,
      blocked: isBlocked(active, faults),
    });
  }

  // ⚠️ #983 — THE ENVIRONMENT PRINTS FIRST, because it is the question a reader is usually asking.
  // On 2026-09-23 every bot below read `OK` while the loop was down and the caps were unevaluable.
  const loopWord = env.loop === true ? 'UP' : env.loop === false ? `DOWN (${formatAge(env.loopAgeMin)} since the last tick)` : 'UNKNOWN';
  console.log(`\n[environment] automation loop: ${loopWord}`);
  if (env.loop === false && env.loopWhy) console.log(`              ${env.loopWhy} — every bot is blocked, whatever its config says.`);
  if (env.loop === null && env.loopWhy) console.log(`              ${env.loopWhy} — cannot judge traffic; this is NOT a pass.`);
  // ⚠️ Stated explicitly, because it CHANGES WHAT THE VERDICTS MEAN. Note this says REPORTED, not
  // BLOCKED — an earlier version of this very line claimed a fresh-elsewhere pipeline made a stale
  // symbol "genuinely starved". Measured, that was wrong: BTC is scored every minute (crypto trades
  // weekends) so the pipeline reads live while every equity market is shut. Corrected, not deleted.
  if (env.pipelineNewestScoreAgeMin != null) {
    const fresh = env.pipelineNewestScoreAgeMin <= STALE_SCORE_MINUTES;
    console.log(`              scoring: newest score anywhere is ${formatAge(env.pipelineNewestScoreAgeMin)} old`);
    console.log(`              (${fresh ? 'something is scoring' : 'nothing is scoring'}), so a symbol older than ` +
      `${STALE_SCORE_MINUTES}m is REPORTED as note:STALE-SCORE.`);
    console.log('              It is NOT a blocker: this script cannot tell "market shut" from "symbol starved".');
  }
  if (env.capProbeFailed) console.log(`\u26a0\ufe0f  cap-evaluability probe FAILED: ${env.capProbeFailed} — cap faults are NOT checked.`);
  if (env.scoreProbeFailed) console.log(`\u26a0\ufe0f  score-freshness probe FAILED: ${env.scoreProbeFailed} — freshness is NOT checked.`);

  console.log('\n[symbol ] [bot                              ] [active] [mode      ] [size] [broker] [tradeMode] [floor] [lastScore                     ] [subs] verdict');
  console.log('-'.repeat(150));
  for (const r of rows) {
    // ⚠️ A NON-BLOCKING fault is still a fact worth printing, but printing it in the same style as a
    // blocker is how "39 OK" and `STALE-SCORE` end up on the same screen and read as a contradiction.
    // Blocking faults print plain; reported-only ones are prefixed `note:` so the two cannot be
    // confused, and the header says which columns are judged.
    const verdict = r.faults.length === 0
      ? 'OK'
      : r.faults.map((f) => (BLOCKING_PREFIXES.some((p) => f.startsWith(p)) ? f : `note:${f}`)).join(' ');
    // ⚠️ An AGE beside the timestamp it was derived from. A bare bar count hides its own date —
    // `13908` reads as healthy whether it was written a second or six hours ago.
    const scoreCol = r.scoreNewest ? `${formatAge(r.scoreAgeMin)} ago` : 'never';
    console.log(
      `${r.ticker.padEnd(8)} ${r.name.slice(0, 32).padEnd(32)} ${String(r.active).padEnd(6)} ` +
      `${r.mode.padEnd(10)} ${String(r.size).padEnd(5)} ${String(r.brokerId).padEnd(7)} ` +
      `${String(r.tradeMode ?? 'n/a').padEnd(10)} ${String(r.floor ?? 'n/a').padEnd(6)} ` +
      `${scoreCol.padEnd(14)} ` +
      `${String(r.subs).padEnd(5)} ${verdict}`,
    );
  }
  console.log('   verdict: a bare code BLOCKS.  `note:` is REPORTED but does NOT block — see below.');

  const activeBlocked = rows.filter((r) => r.blocked);
  const inactive = rows.filter((r) => !r.active);
  // ⚠️ `OK` now means "configured AND the environment can act on it". The heading says so, because
  // a reader who has been misled by the old `OK` once will not trust the new one without a reason.
  console.log(`\n${rows.length} bot(s): ${rows.length - activeBlocked.length - inactive.length} OK (configured AND the loop running), ` +
    `${activeBlocked.length} ACTIVE BUT BLOCKED, ${inactive.length} inactive.`);

  // ⚠️ #983 — the environment faults are GLOBAL, so them appearing once per bot reads as 27 separate
  // problems. Summarise them separately so the reader sees one cause, not a wall of identical rows.
  const globalFaults = [...new Set(rows.flatMap((r) => r.faults).filter((f) =>
    f.startsWith('LOOP-DOWN') || f.startsWith('LOOP-UNKNOWN') || f.startsWith('CAP-UNEVALUABLE')))];
  if (globalFaults.length) {
    console.log('\n\u26a0\ufe0f  ENVIRONMENT \u2014 affects EVERY bot, not the ones below:');
    for (const f of globalFaults) console.log(`   ${f}`);
  }

  const nonMt5Rows = rows.filter((r) => r.faults.some((f) => f.startsWith('NON-MT5-VENUE')));
  if (nonMt5Rows.length) {
    console.log('\nNON-MT5 VENUE — routed elsewhere; MT5 tradeMode/floor do NOT apply, so they are not checked:');
    for (const r of nonMt5Rows) {
      const which = r.faults.filter((f) => f.startsWith('NON-MT5-VENUE')).join(' ');
      console.log(`  ${r.ticker.padEnd(8)} ${r.name} — ${which}  (an MT5 floor here is NOT a fault)`);
    }
  }

  const unavailable = rows.filter((r) => r.faults.some((f) => f.startsWith('BRIDGE-UNAVAILABLE')));
  if (unavailable.length) {
    console.log('\n\u26a0\ufe0f  CANNOT JUDGE — a bridge did not answer its symbol list, so these were NOT checked:');
    for (const r of unavailable) {
      const why = r.faults.filter((f) => f.startsWith('BRIDGE-UNAVAILABLE')).join(' ');
      console.log(`  ${r.ticker.padEnd(8)} ${r.name} — ${why}`);
    }
    console.log('   This is NOT evidence the broker lacks the symbol. Fix the bridge, then re-run.');
  }

  if (activeBlocked.length) {
    console.log('\nACTIVE BUT BLOCKED — these are configured to trade and cannot:');
    for (const r of activeBlocked) {
      console.log(`  ${r.ticker.padEnd(8)} ${r.name} — ${r.faults.join(' ')}` +
        (r.faults.some((f) => f.startsWith('BELOW-FLOOR'))
          ? `  → raise baseSize to ${r.floor} (the broker minimum)`
          : ''));
    }
  }
  if (inactive.length) {
    console.log('\nINACTIVE — not generating data. Activate only if the symbol has bars AND a tradeable broker:');
    for (const r of inactive) {
      const why = r.faults.filter((f) => f !== 'INACTIVE').join(' ') || 'nothing blocking';
      console.log(`  ${r.ticker.padEnd(8)} ${r.name} — ${why}`);
    }
  }

  await prisma.$disconnect();
  process.exit(activeBlocked.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`audit failed: ${err.message}`);
  process.exit(1);
});
