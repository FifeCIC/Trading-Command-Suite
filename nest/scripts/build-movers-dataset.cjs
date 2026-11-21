#!/usr/bin/env node
/**
 * build-movers-dataset.cjs — build a `movers-{winners|losers}-YYYY-MM-DD` day list from stored bars (#1322).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────
 * A movers backtest measures ONE session per stored list, and the strategy's whole premise is that
 * the day's top movers change constantly — so a win rate needs many days. Measured 2026-11-19: only
 * two day lists existed (`movers-losers-2026-11-10`, `movers-winners-2026-11-11`), both written by
 * hand through `POST /api/backtest/periods`, and **nothing in the repo could add a third**. So the
 * strategy had a sample of one session per side.
 *
 * This is that missing builder: screen a session's movers from bars the app already stores, then
 * write the `backtest_period` group the movers page and `POST /api/backtest/selection-run` read.
 *
 * ── THE SHAPE IT WRITES (the convention the two hand-made lists set) ─────────────────────────────
 * `backtest_period` is PER SYMBOL, so ONE group name → MANY rows, one per symbol:
 *
 *   name       `movers-{side}-YYYY-MM-DD`      ← `movers-dataset.ts` parses this; a name it cannot
 *                                                 parse is EXCLUDED from the movers page
 *   timeframe  `5m`
 *   fromDate   00:00Z of the 5th-most-recent session BEFORE the answer day (directive warm-up)
 *   toDate     00:00Z of the day AFTER the answer day (so the answer day is inside the window)
 *
 * ⚠️ THE ANSWER DAY IS THE DATE IN THE NAME, NOT `toDate`. `movers-dataset.ts` (2026-11-19) records
 * why: ranking the ten symbols on every day of the window reported four warm-up days where those
 * names were not movers, and it looked like a result. The warm-up sessions exist for the directives.
 *
 * ── WHAT IT SCREENS, AND WHAT IT CANNOT ─────────────────────────────────────────────────────────
 * The screen is computed from `marketbar` — real stored bars, never a published list. For each symbol
 * the session close is taken from its `1d` series when present, otherwise from the last `5m` bar of
 * that UTC day (a US cash session runs 14:30→21:00 UTC and never straddles midnight UTC, so the UTC
 * date IS the session date; verified against the stored 5m series).
 *
 * 🛑 THE UNIVERSE IS STORED DATA, AND IT IS SMALL. Measured 2026-11-21: `marketbar` holds daily bars
 * for **53 symbols** and 5m bars for **72**, while the two hand-made lists' notes cite
 * *"6,119 active NYSE/NASDAQ common stocks"* — a universe whose daily series was fetched at build
 * time and is **not in this database**. So a symbol with no session close for the answer day cannot
 * be ranked, and the run says so with a count rather than quietly screening a smaller market. Making
 * that universe real is the bar-ingestion work in #1321; it does not have to land for THIS tool to be
 * correct, it only caps how many names it can offer.
 *
 * ── EXCLUSIONS ARE NAMED, NEVER SILENT ──────────────────────────────────────────────────────────
 * The two hand-made lists excluded 12 of 22 candidates, most for a 5m-vs-daily SCALE MISMATCH caused
 * by an unadjusted split (their own note). The same check runs here and every candidate it removes is
 * printed with the measured ratio. When there is no independent `1d` series the check CANNOT RUN, and
 * it says `not run` — the repo's rule is that "cannot judge" is never reported as "fine".
 *
 * USAGE (from nest/):
 *   node scripts/build-movers-dataset.cjs --side losers --date 2026-11-10 --dry-run
 *   node scripts/build-movers-dataset.cjs --side winners --date 2026-11-11 --dry-run
 *   node scripts/build-movers-dataset.cjs --side losers --date 2026-11-09            # writes
 *   node scripts/build-movers-dataset.cjs --self-test
 *
 * ⚠️ `--dry-run` writes NOTHING and imports nothing — same plan, same exclusions, no side effects.
 * ⚠️ Idempotent: a row is found by (name, symbolId, timeframe) and updated, never duplicated. There
 *    is no unique key on that triple (only an index — see seed-dev-test-window.cjs), so a re-run is
 *    how a gap gets fixed, and duplicates would be reported rather than created.
 *    ⚠️ Idempotent is NOT the same as "the group equals the top N": a re-run whose screen changes
 *    leaves the previous picks in place. Extras are reported, and removed only with `--prune`.
 * ⚠️ 5m bars are captured through the EXISTING import route (`POST /api/backtest/periods/:id/import`),
 *    which already owns provider order, truncation reporting and "an existing bar is never
 *    overwritten". This script does not re-implement provider fetching.
 */
'use strict';

const { runCases } = require('../../scripts/lib/self-test.cjs');

// ── The dataset convention. These are the SAME facts `movers-dataset.ts` and the two hand-made
//    lists encode; they are asserted against the compiled contract in `--self-test`.
const NAME_PATTERN = /^movers-(winners|losers)-(\d{4})-(\d{2})-(\d{2})$/;
const DATASET_TIMEFRAME = '5m';
const RANK_TIMEFRAMES = ['1d', '5m'];

/**
 * Prior sessions written into every row's window.
 *
 * ⚠️ 5 IS A CONTRACT, NOT A TUNING KNOB. Both hand-made lists hold five sessions before their answer
 * day because the directives need history before they will emit anything; a window with fewer
 * sessions produces "insufficient bars" abstentions that read as a strategy result. When stored data
 * cannot supply five, the run SAYS SO in the note rather than silently writing a shorter window.
 */
const WARMUP_SESSIONS = 5;

/** Days of bars read before the answer day. Must cover 5 sessions plus weekends/holidays. */
const DEFAULT_LOOKBACK_DAYS = 30;

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PURE — every branch below is testable without a database or a network (`--self-test`)
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** `true` when `YYYY-MM-DD` names a real calendar day. 2026-02-30 is not one. */
function isRealDate(y, m, d) {
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

/**
 * buildDatasetName() — the ONE string a movers dataset may be called.
 *
 * ⚠️ IT REFUSES RATHER THAN SANITISES. `POST /api/backtest/selection-run` rejects a name that does not
 * match `^movers-(winners|losers)-YYYY-MM-DD$`, so a relaxed builder would write rows that the page
 * then EXCLUDES — a successful build producing an unusable dataset, with nothing failing.
 */
function buildDatasetName(side, dateStr) {
  if (side !== 'winners' && side !== 'losers') {
    throw new Error(`side must be 'winners' or 'losers', got '${String(side)}'`);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? '').trim());
  if (!m) throw new Error(`date must be YYYY-MM-DD, got '${String(dateStr)}'`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isRealDate(y, mo, d)) throw new Error(`'${dateStr}' is not a real date`);
  return `movers-${side}-${m[1]}-${m[2]}-${m[3]}`;
}

/** The UTC session day of a bar. A US cash session never straddles midnight UTC. */
function dayOf(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * collectSessions() — fold raw bars into one close per (symbol, day), from ONE series per symbol.
 *
 * 🛑 ONE SERIES PER SYMBOL, CHOSEN ONCE — `5m` when the symbol has any, otherwise `1d`.
 *
 * Measured 2026-11-21, and it is the reason this is not "prefer the daily bar":
 *
 *   NVDA  1d stamped 2026-11-03T21:00Z → 200.13     5m close 2026-11-04T20:55Z → 200.13
 *         1d stamped 2026-11-02T21:00Z → 206.69     5m close 2026-11-03T20:55Z → 206.69
 *
 * The stored `1d` series for US equities is stamped on a rolling 24h boundary, so its close is
 * the NEXT session's close. Preferring the daily bar therefore moves every session by one day, and
 * mixing the two series invents a Sunday session (a 1d bar stamped 11-08T21:00Z with no 5m bars that
 * day) — measured: that alone excluded NVDA, AAPL, MSFT, GOOGL, RBLX, MSTR, SPCE, SOUN, METC and EH
 * from the 2026-11-09 screen with "no 5m bars before the answer day", all of them perfectly good.
 *
 * ⚠️ AND 5m IS THE RIGHT SOURCE ANYWAY. This is a 5m dataset: the ranking must agree with the bars
 * the backtest will read, or a symbol is chosen on one series and measured on another.
 */
function collectSessions(rows) {
  const bySymbol = new Map();
  for (const r of rows) {
    const day = dayOf(r.timestamp);
    const t = new Date(r.timestamp).getTime();
    let sym = bySymbol.get(r.symbolId);
    if (!sym) {
      sym = { days: new Map() };
      bySymbol.set(r.symbolId, sym);
    }
    let slot = sym.days.get(day);
    if (!slot) {
      slot = { close1d: null, ts1d: 0, close5m: null, ts5m: 0, bars5m: 0 };
      sym.days.set(day, slot);
    }
    if (r.timeframe === '1d') {
      if (slot.close1d === null || t >= slot.ts1d) {
        slot.close1d = Number(r.close);
        slot.ts1d = t;
      }
    } else if (r.timeframe === '5m') {
      slot.bars5m++;
      if (slot.close5m === null || t >= slot.ts5m) {
        slot.close5m = Number(r.close);
        slot.ts5m = t;
      }
    }
  }
  for (const sym of bySymbol.values()) {
    const series = [...sym.days.values()].some((s) => s.bars5m > 0) ? '5m' : '1d';
    sym.series = series;
    // Kept BEFORE the chosen-series filter below, so the daily side of the agreement check still
    // sees days the chosen series does not cover.
    sym.d1Days = new Map();
    sym.samples = [];
    for (const [day, slot] of sym.days) {
      if (slot.close1d !== null) sym.d1Days.set(day, slot.close1d);
      if (slot.close5m !== null && slot.close1d !== null) {
        sym.samples.push({ day, close5m: slot.close5m, close1d: slot.close1d });
      }
    }
    for (const [day, slot] of [...sym.days]) {
      const close = series === '5m' ? slot.close5m : slot.close1d;
      if (close === null) {
        // Not part of this symbol's chosen series — dropped rather than borrowed from the other one.
        sym.days.delete(day);
        continue;
      }
      slot.close = close;
      slot.source = series;
    }
  }
  return bySymbol;
}

/**
 * sessionDaysBefore() — the trading calendar implied by the stored bars.
 *
 * ⚠️ IT IS DERIVED FROM SYMBOLS THAT ACTUALLY HAVE A SESSION CLOSE, and that matters: crypto bars
 * exist on Saturdays and Sundays, so a calendar built from every symbol would put 11-07/11-08 into
 * an equities window and move `fromDate` two days. The universe passed in is the one being screened
 * for this side, so the calendar matches the data the rows will point at.
 */
function sessionDaysBefore(bySymbol, symbolIds, answerDate) {
  const days = new Set();
  for (const id of symbolIds) {
    const sym = bySymbol.get(id);
    if (!sym) continue;
    for (const [day, slot] of sym.days) {
      if (slot.close !== null && day < answerDate) days.add(day);
    }
  }
  return [...days].sort();
}

/** 00:00Z of the 5th-most-recent session before the answer day (or the earliest available). */
function warmupStart(daysBefore, answerDate) {
  if (!daysBefore.length) return { from: null, sessions: 0, short: true };
  const chosen = daysBefore.slice(-WARMUP_SESSIONS);
  return { from: chosen[0], sessions: chosen.length, short: chosen.length < WARMUP_SESSIONS };
}

/**
 * sessionsBackOf() — how many market sessions a move actually spans.
 *
 * ⚠️ A SYMBOL WHOSE SERIES STARTS MID-WINDOW HAS NO ADJACENT PREVIOUS SESSION, so its "single-day"
 * move is really a multi-session move. Measured on the stored `movers-winners-2026-11-11` list: SFWL
 * has one session of bars, so its +43.9% is measured from 2026-11-06 — three sessions earlier. The
 * number is still a fact; reporting it as "one day" is not. It is printed beside the move rather than
 * used to exclude the symbol, because the hand-made list accepted it and silently changing the
 * population would break comparability with the day lists that already exist.
 */
function sessionsBackOf(prevDay, answerDate, marketDays) {
  return marketDays.filter((d) => d > prevDay && d < answerDate).length + 1;
}

/**
 * movesFor() — the close-to-close move of every symbol that has an answer-day close and a previous one.
 *
 * ⚠️ ONE ROW PER SYMBOL, AND THE PREVIOUS SESSION IS THE PREVIOUS *STORED* SESSION. A symbol whose
 * series starts mid-window gets a two-day move reported as one day; that is not detectable here, so
 * the previous day is carried in the row and printed, which makes it checkable by the reader.
 */
function movesFor(bySymbol, answerDate) {
  const out = [];
  for (const [symbolId, sym] of bySymbol) {
    const today = sym.days.get(answerDate);
    if (!today || today.close === null || !(today.close > 0)) continue;
    const earlier = [...sym.days.keys()].filter((d) => d < answerDate).sort();
    const prevDay = earlier.length ? earlier[earlier.length - 1] : null;
    if (!prevDay) continue;
    const prev = sym.days.get(prevDay);
    if (!prev || prev.close === null || !(prev.close > 0)) continue;

    // The DAILY series' own move for the same calendar day, computed from ITS days — not read off a
    // price level. This is what the agreement check compares, and it is robust to the daily series
    // being stamped a session ahead (see `collectSessions`): both numbers are day-over-day moves.
    let pct1d = null;
    if (sym.d1Days) {
      const d1Today = sym.d1Days.get(answerDate);
      const d1Earlier = [...sym.d1Days.keys()].filter((d) => d < answerDate).sort();
      const d1PrevDay = d1Earlier.length ? d1Earlier[d1Earlier.length - 1] : null;
      const d1Prev = d1PrevDay ? sym.d1Days.get(d1PrevDay) : null;
      if (d1Today > 0 && d1Prev > 0) pct1d = (d1Today / d1Prev - 1) * 100;
    }

    out.push({
      symbolId,
      prevDay,
      prevClose: prev.close,
      prevClose5m: prev.close5m,
      prevClose1d: prev.close1d,
      close: today.close,
      close5m: today.close5m,
      close1d: today.close1d,
      bars5m: today.bars5m,
      source: today.source,
      samples: sym.samples,
      pct1d,
      pct: (today.close / prev.close - 1) * 100,
    });
  }
  return out;
}

/** Rank a day's moves. Losers → most negative first; winners → most positive first. */
function rankMoves(moves, side) {
  const copy = [...moves];
  copy.sort((a, b) => (side === 'losers' ? a.pct - b.pct : b.pct - a.pct));
  return copy;
}

/**
 * levelRatio() — the median 5m/daily PRICE ratio over the window. CONTEXT ONLY, never the verdict.
 *
 * ⚠️ IT LOOKS LIKE THE OBVIOUS SPLIT TEST AND IT IS NOT ONE. The stored `1d` series for US equities is
 * stamped a session ahead (see `collectSessions`), so 5m(D)/1d(D) ≈ 5m(D)/5m(D+1) — it equals the
 * stock's DAILY RETURN. Measured 2026-11-21: NVDA's median came out at **1.03x**, because NVDA fell
 * ~7% over the window. Judging on that ratio excluded NVDA as an "unadjusted split" when nothing of
 * the kind had happened. It is reported beside the verdict so a reader can see the level, and it
 * decides nothing.
 */
function levelRatio(samples) {
  const ratios = [];
  for (const s of samples ?? []) {
    const five = Number(s.close5m);
    const one = Number(s.close1d);
    if (Number.isFinite(five) && Number.isFinite(one) && five > 0 && one > 0) ratios.push(five / one);
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  return ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
}

/**
 * seriesAgreement() — do the 5m and daily series describe the SAME move for this session?
 *
 * ⚠️ THE HAZARD IT CATCHES IS AN UNADJUSTED SPLIT, and this is the check that actually finds one. The
 * hand-made `movers-losers-2026-11-10` note records 12 of 22 candidates excluded for it ("WHLR
 * (5m/daily 0.54x — unadjusted 1:6 split)"). An unadjusted intraday series reports a −83% session that
 * never happened, while the adjusted daily series reports −2%: the two MOVES for one session diverge
 * by tens of percentage points. Comparing moves therefore separates the two series directly, and —
 * unlike a price-level ratio — it is immune to the daily series' one-session stamp offset, because
 * each side is measured against its own previous close.
 *
 * ⚠️ `not-run` IS A THIRD OUTCOME, NOT A PASS. With no daily close for the answer day there is
 * nothing to compare, and "consistent" would be a guard passing because it never ran.
 */
function seriesAgreement(pct5m, pct1d, tolerancePp) {
  // ⚠️ `Number(null)` IS `0`, NOT `NaN` — the same trap `alignBarTimestamp` documents for `new Date(null)`.
  // Without this guard a missing daily close reads as a 0% daily move and a −10% session looks like a
  // 10pp disagreement with "the daily series", i.e. a confident verdict computed from nothing.
  if (pct5m === null || pct5m === undefined || pct1d === null || pct1d === undefined) {
    return { status: 'not-run', deltaPp: null, reason: 'no daily close for the answer day to compare against' };
  }
  const five = Number(pct5m);
  const one = Number(pct1d);
  if (!Number.isFinite(five) || !Number.isFinite(one)) {
    return { status: 'not-run', deltaPp: null, reason: 'no daily close for the answer day to compare against' };
  }
  const deltaPp = Math.abs(five - one);
  if (deltaPp > tolerancePp) {
    return {
      status: 'mismatch',
      deltaPp,
      reason:
        `5m move ${five.toFixed(1)}% and daily move ${one.toFixed(1)}% disagree by ` +
        `${deltaPp.toFixed(1)}pp — one series is not adjusted for a corporate action (split?)`,
    };
  }
  return { status: 'ok', deltaPp, reason: null };
}

/**
 * evaluateCandidate() — accept one ranked candidate, or name the measured reason it cannot be used.
 *
 * Order matters: a symbol with no intraday bars is rejected before the scale check, because a check
 * that cannot run must not be reported as the reason for an exclusion it did not cause.
 */
function evaluateCandidate(c, opts) {
  if (!(c.bars5m > 0)) {
    return {
      accepted: false,
      rule: 'no-5m-bars-on-answer-day',
      detail: 'no 5m bars stored on the answer day — the intraday run would have nothing to measure',
    };
  }
  if (!(c.prevClose5m > 0)) {
    return {
      accepted: false,
      rule: 'no-5m-bars-before-answer-day',
      detail: '5m bars exist on the answer day but not before it — no warm-up, no previous close',
    };
  }
  if (opts.minPrice > 0 && c.close < opts.minPrice) {
    return {
      accepted: false,
      rule: 'below-min-price',
      detail: `close ${c.close} < --min-price ${opts.minPrice}`,
    };
  }
  const agree = seriesAgreement(c.pct, c.pct1d, opts.seriesTolerance);
  if (agree.status === 'mismatch') {
    return { accepted: false, rule: 'scale-mismatch', detail: agree.reason };
  }
  const level = levelRatio(c.samples);
  return {
    accepted: true,
    rule: null,
    detail: null,
    scale:
      agree.status === 'ok'
        ? `5m ${c.pct.toFixed(1)}% vs daily ${Number(c.pct1d).toFixed(1)}% (${agree.deltaPp.toFixed(1)}pp apart)` +
          (level === null ? '' : ` · level ${level.toFixed(2)}x`)
        : 'series check NOT RUN (no daily close for the answer day)',
  };
}

/** The dataset note. Records the screen, the counts and every exclusion — the durable provenance. */
function buildNote(input) {
  const { side, answerDate, top, rankedUniverse, unranked, examined, excluded, accepted, window } = input;
  const headline = accepted[0]
    ? `Headline: ${accepted[0].ticker} ${accepted[0].pct >= 0 ? '+' : ''}${accepted[0].pct.toFixed(1)}%.`
    : 'Headline: none — nothing passed the checks.';
  const reasons = new Map();
  for (const e of excluded) reasons.set(e.rule, (reasons.get(e.rule) ?? 0) + 1);
  const reasonText = [...reasons.entries()].map(([r, n]) => `${n} ${r}`).join(', ') || 'none';
  const exclusionText = excluded.length
    ? ` Excluded: ${excluded.map((e) => `${e.ticker} (${e.detail})`).join('; ')}.`
    : '';
  const shortWarmup = window.short
    ? ` ⚠️ Only ${window.sessions} prior session(s) could be supplied from stored bars, not the usual ` +
      `${WARMUP_SESSIONS} — the directives may abstain more than on a full window.`
    : '';
  // ⚠️ A "single-day" move measured across a gap is still reported, and it is LABELLED. See
  // `sessionsBackOf` for why it is not used to exclude the symbol.
  const spanned = (input.spans ?? []).filter((s) => s.sessionsBack > 1);
  const spanText = spanned.length
    ? ` ⚠️ Measured from a close more than one session back (no adjacent session stored): ` +
      `${spanned.map((s) => `${s.ticker} ${s.pct.toFixed(1)}%`).join(', ')}. Those moves span more ` +
      'than one session, so they are not strictly single-day.'
    : '';
  return (
    `EXTREME-${side === 'winners' ? 'GAINER' : 'LOSER'} DAY. Top ${accepted.length} usable ` +
    `${side} by single-day close-to-close % across ${rankedUniverse} symbol(s) with a stored session ` +
    `close on ${answerDate} — computed from real bars in \`marketbar\`, not a published list. ` +
    `${headline} ${examined} candidate(s) were examined and ${excluded.length} were excluded with ` +
    `reasons (${reasonText}).${exclusionText} ` +
    (window.from
      ? `Includes ${window.sessions} prior session(s) (${window.from} to ${answerDate}) for directive warm-up.`
      : 'No prior sessions were available for warm-up.') +
    shortWarmup +
    spanText +
    (unranked > 0
      ? ` ${unranked} further symbol(s) in the screened universe had no stored session close for ` +
        `${answerDate} and could not be ranked (#1321 tracks capturing a full-market daily series).`
      : '')
  );
}

/** Every flag this tool accepts. Anything else is refused, so a typo cannot be read as a default. */
const KNOWN_FLAGS = [
  '--side', '--date', '--top', '--examine', '--min-price', '--series-tolerance',
  '--universe', '--active-only', '--dry-run', '--no-import', '--prune', '--base-url',
  '--lookback-days', '--self-test', '--help',
];

/**
 * parseArgs() — turn argv into a plan, or into a refusal that names the problem.
 *
 * ⚠️ IT DOES NOT GUESS A SIDE OR A DATE. Both are printed into the dataset's NAME, which the movers
 * page and the run both parse; a defaulted date would create a day list for a session nobody asked
 * about, and it would look completely normal in the list.
 */
function parseArgs(argv) {
  const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN_FLAGS.includes(a));
  if (unknown.length) {
    return { ok: false, reason: `unknown flag(s): ${unknown.join(', ')}. Try --help.`, plan: null };
  }
  const val = (flag, fallback) => {
    const i = argv.indexOf(flag);
    if (i < 0) return fallback;
    const raw = argv[i + 1];
    if (raw === undefined || raw.startsWith('--')) return fallback;
    return raw;
  };
  const num = (flag, fallback) => {
    const raw = val(flag, null);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  };

  const side = val('--side', null);
  const date = val('--date', null);
  const top = num('--top', 10);
  const examine = num('--examine', Math.max(top * 3, top + 10));
  const minPrice = num('--min-price', 0);
  const seriesTolerance = num('--series-tolerance', 25);
  const universe = val('--universe', 'stocks');
  const lookbackDays = num('--lookback-days', DEFAULT_LOOKBACK_DAYS);

  if (!side) return { ok: false, reason: '--side winners|losers is required (it is part of the dataset name)', plan: null };
  if (side !== 'winners' && side !== 'losers') return { ok: false, reason: `--side must be winners or losers, got '${side}'`, plan: null };
  if (!date) return { ok: false, reason: '--date YYYY-MM-DD is required (it is part of the dataset name)', plan: null };
  if (Number.isNaN(top) || top < 1) return { ok: false, reason: `--top must be a positive integer, got '${val('--top', '')}'`, plan: null };
  if (Number.isNaN(examine) || examine < top) return { ok: false, reason: `--examine must be >= --top (${top}), got '${val('--examine', '')}'`, plan: null };
  if (Number.isNaN(minPrice) || minPrice < 0) return { ok: false, reason: `--min-price must be >= 0, got '${val('--min-price', '')}'`, plan: null };
  if (Number.isNaN(seriesTolerance) || seriesTolerance < 0) return { ok: false, reason: `--series-tolerance must be >= 0 (percentage points), got '${val('--series-tolerance', '')}'`, plan: null };
  if (universe !== 'stocks' && universe !== 'all') return { ok: false, reason: `--universe must be stocks or all, got '${universe}'`, plan: null };
  if (Number.isNaN(lookbackDays) || lookbackDays < 10) return { ok: false, reason: `--lookback-days must be >= 10, got '${val('--lookback-days', '')}'`, plan: null };

  let name;
  try {
    name = buildDatasetName(side, date);
  } catch (e) {
    return { ok: false, reason: e.message, plan: null };
  }

  return {
    ok: true,
    reason: null,
    plan: {
      side,
      answerDate: String(date).trim(),
      name,
      top,
      examine,
      minPrice,
      seriesTolerance,
      universe,
      activeOnly: argv.includes('--active-only'),
      dryRun: argv.includes('--dry-run'),
      noImport: argv.includes('--no-import'),
      prune: argv.includes('--prune'),
      baseUrl: String(val('--base-url', 'http://localhost:3201')).replace(/\/$/, ''),
      lookbackDays,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// --self-test
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The compiled contract, when a build is present. Used as a CROSS-CHECK on `buildDatasetName`, so the
 * script and the service cannot drift into disagreeing about what a valid name is.
 */
function loadCompiledContract() {
  try {
    return require('../dist/src/modules/backtest/movers-dataset.js');
  } catch {
    return null;
  }
}

function selfTest() {
  const cases = [];
  const t = (name, fn) => cases.push({ name, fn });

  t('builds the exact name the contract parses', () => buildDatasetName('losers', '2026-11-10') === 'movers-losers-2026-11-10');
  t('builds the winners form too', () => buildDatasetName('winners', '2026-11-11') === 'movers-winners-2026-11-11');
  t('matches the NAME_PATTERN the service enforces', () => NAME_PATTERN.test(buildDatasetName('losers', '2026-11-10')));
  t('refuses a date that is not a real day', () => {
    try { buildDatasetName('losers', '2026-02-30'); return false; } catch { return true; }
  });
  t('refuses an unknown side rather than defaulting', () => {
    try { buildDatasetName('long', '2026-11-10'); return false; } catch { return true; }
  });
  t('refuses a malformed date', () => {
    try { buildDatasetName('losers', '10/11/2026'); return false; } catch { return true; }
  });

  // ── the compiled contract is the authority; this fails if the two ever disagree ──
  t('agrees with the compiled parseMoversDatasetName()', () => {
    const contract = loadCompiledContract();
    if (!contract?.parseMoversDatasetName) return false; // a missing build must not read as a pass
    for (const [side, date] of [['losers', '2026-11-10'], ['winners', '2026-11-11'], ['winners', '2026-01-01']]) {
      const parsed = contract.parseMoversDatasetName(buildDatasetName(side, date));
      if (!parsed.value || parsed.value.side !== side || parsed.value.answerDate !== date) return false;
    }
    return true;
  });

  const bars = [
    { symbolId: 's1', timeframe: '5m', timestamp: '2026-11-09T14:30:00Z', close: 8 },
    { symbolId: 's1', timeframe: '5m', timestamp: '2026-11-09T20:55:00Z', close: 8.5 },
    { symbolId: 's1', timeframe: '5m', timestamp: '2026-11-10T14:30:00Z', close: 10 },
    { symbolId: 's1', timeframe: '5m', timestamp: '2026-11-10T17:00:00Z', close: 11 },
    { symbolId: 's1', timeframe: '5m', timestamp: '2026-11-10T20:55:00Z', close: 12 },
    { symbolId: 's1', timeframe: '1d', timestamp: '2026-11-09T21:00:00Z', close: 9 },
    { symbolId: 's1', timeframe: '1d', timestamp: '2026-11-10T21:00:00Z', close: 12.5 },
    // A day the 5m series does not cover — it must NOT leak into s1's session series.
    { symbolId: 's1', timeframe: '1d', timestamp: '2026-11-11T21:00:00Z', close: 13 },
    { symbolId: 's2', timeframe: '5m', timestamp: '2026-11-10T14:30:00Z', close: 5 },
    // s3 has daily bars only, so its series IS the daily one.
    { symbolId: 's3', timeframe: '1d', timestamp: '2026-11-09T21:00:00Z', close: 40 },
    { symbolId: 's3', timeframe: '1d', timestamp: '2026-11-10T21:00:00Z', close: 44 },
  ];

  t('takes the LAST 5m bar of the day as the close, not the first or the highest', () => {
    const s = collectSessions(bars).get('s1');
    return s.days.get('2026-11-10').close === 12 && s.days.get('2026-11-10').bars5m === 3;
  });
  t('uses the 5m series for a symbol that has one, even where a daily close also exists', () => {
    const slot = collectSessions(bars).get('s1').days.get('2026-11-10');
    return slot.close === 12 && slot.source === '5m';
  });
  t('drops a day the chosen series does not cover instead of borrowing the other series', () => {
    const s = collectSessions(bars).get('s1');
    return !s.days.has('2026-11-11');
  });
  t('uses the daily series for a symbol with no intraday bars, and says so', () => {
    const s = collectSessions(bars).get('s3');
    return s.series === '1d' && s.days.get('2026-11-10').close === 44 && s.days.get('2026-11-10').source === '1d';
  });

  const bySymbol = collectSessions(bars);
  const moves = movesFor(bySymbol, '2026-11-10');
  t('computes close-to-close against the previous STORED session', () => {
    const m = moves.find((x) => x.symbolId === 's1');
    return !!m && m.prevDay === '2026-11-09' && Math.abs(m.pct - (12 / 8.5 - 1) * 100) < 1e-9;
  });
  t('skips a symbol with no answer-day close rather than scoring it 0', () => !movesFor(bySymbol, '2026-11-30').length);
  t('carries the both-series samples the scale check needs', () => {
    const m = moves.find((x) => x.symbolId === 's1');
    return Array.isArray(m.samples) && m.samples.length === 2;
  });

  const pool = [
    { symbolId: 'a', pct: -5 },
    { symbolId: 'b', pct: 9 },
    { symbolId: 'c', pct: -20 },
    { symbolId: 'd', pct: 1 },
  ];
  t('ranks losers most-negative first', () => rankMoves(pool, 'losers').map((x) => x.symbolId).join('') === 'cadb');
  t('ranks winners most-positive first', () => rankMoves(pool, 'winners').map((x) => x.symbolId).join('') === 'bdac');
  // The trap: the two orders must differ, or the side is being ignored.
  t('does NOT return the winners order for a losers screen', () =>
    rankMoves(pool, 'losers').map((x) => x.symbolId).join('') !== rankMoves(pool, 'winners').map((x) => x.symbolId).join(''));
  t('leaves the caller\'s array untouched', () => {
    const before = pool.map((x) => x.symbolId).join('');
    rankMoves(pool, 'winners');
    return pool.map((x) => x.symbolId).join('') === before;
  });

  t('agreement passes two series describing the same move', () =>
    seriesAgreement(-4.3, -5.5, 25).status === 'ok');
  t('agreement catches an unadjusted split (a −83% session against a −2% one)', () => {
    const v = seriesAgreement(-83.2, -2.1, 25);
    return v.status === 'mismatch' && /81\.1pp/.test(v.reason);
  });
  // The measured stamping offset shifts WHICH session each side measures, so ordinary day-over-day
  // differences must not be read as a split. Measured: NVDA's whole-window price ratio was 1.03x.
  t('agreement is not fooled by a one-session offset between the series', () =>
    seriesAgreement(-4.3, -5.5, 25).status === 'ok' && seriesAgreement(9.1, -8.0, 25).status === 'ok');
  t('agreement says NOT-RUN when there is no daily close — it does not pass', () => {
    const v = seriesAgreement(-4.3, null, 25);
    return v.status === 'not-run' && /no daily close/.test(v.reason);
  });
  t('level ratio is reported as context and is null without samples', () =>
    levelRatio([{ close5m: 10, close1d: 10 }, { close5m: 11, close1d: 10 }]) === 1.05 && levelRatio([]) === null);

  const good = {
    symbolId: 'x', ticker: 'X', pct: -10, close: 5, bars5m: 78, prevClose5m: 5.5, prevClose1d: 5.5,
    samples: [{ close5m: 5.5, close1d: 5.5 }, { close5m: 5.0, close1d: 5.02 }], pct1d: -10.5,
  };
  const opts = { minPrice: 0, seriesTolerance: 25 };
  t('accepts a candidate with bars, a previous close and a matching scale', () => evaluateCandidate(good, opts).accepted === true);
  t('rejects a candidate with no 5m bars on the answer day, naming that rule', () => {
    const r = evaluateCandidate({ ...good, bars5m: 0 }, opts);
    return !r.accepted && r.rule === 'no-5m-bars-on-answer-day';
  });
  t('rejects a candidate with no intraday history before the answer day', () => {
    const r = evaluateCandidate({ ...good, prevClose5m: null }, opts);
    return !r.accepted && r.rule === 'no-5m-bars-before-answer-day';
  });
  t('rejects a series disagreement and quotes the divergence', () => {
    const r = evaluateCandidate({ ...good, pct: -83.2, pct1d: -2.1 }, opts);
    return !r.accepted && r.rule === 'scale-mismatch' && /81\.1pp/.test(r.detail);
  });
  t('states NOT RUN when there is no daily close, rather than claiming a pass', () => {
    const r = evaluateCandidate({ ...good, pct1d: null }, opts);
    return r.accepted === true && /NOT RUN/.test(r.scale);
  });
  t('applies --min-price only when it is set', () => {
    const low = { ...good, close: 0.02 };
    return evaluateCandidate(low, opts).accepted === true && evaluateCandidate(low, { ...opts, minPrice: 0.05 }).rule === 'below-min-price';
  });

  // The window the hand-made `movers-losers-2026-11-10` uses: five sessions before the answer day,
  // so `fromDate` is 2026-11-03 — not 2026-11-02 and not 2026-10-30.
  t('picks the 5th-most-recent session as the warm-up start', () => {
    const days = ['2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09'];
    const w = warmupStart(days, '2026-11-10');
    return w.from === '2026-11-03' && w.sessions === 5 && w.short === false;
  });
  t('flags a short warm-up instead of pretending five sessions exist', () => {
    const w = warmupStart(['2026-11-06', '2026-11-09'], '2026-11-10');
    return w.from === '2026-11-06' && w.sessions === 2 && w.short === true;
  });
  t('returns no window at all when nothing earlier is stored', () => warmupStart([], '2026-11-10').from === null);
  t('counts an adjacent previous session as one session back', () =>
    sessionsBackOf('2026-11-09', '2026-11-10', ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10']) === 1);
  // SFWL in the stored winners-2026-11-11 list: one session of bars, so its move spans 11-06 → 11-11.
  t('counts a multi-session gap, so a "single-day" move cannot hide one', () =>
    sessionsBackOf('2026-11-06', '2026-11-11', ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11']) === 3);
  t('the note labels a move measured across a gap', () => {
    const note = buildNote({
      side: 'winners', answerDate: '2026-11-11', rankedUniverse: 29, unranked: 0, examined: 10,
      accepted: [{ ticker: 'SFWL', pct: 43.9 }, { ticker: 'BGS', pct: 37 }], excluded: [],
      window: { from: '2026-11-04', sessions: 5, short: false },
      spans: [{ ticker: 'SFWL', pct: 43.9, sessionsBack: 3 }, { ticker: 'BGS', pct: 37, sessionsBack: 1 }],
    });
    return /SFWL 43\.9%/.test(note) && /more than one session/.test(note) && !/BGS 37/.test(note);
  });
  t('builds the calendar only from days BEFORE the answer day', () => {
    const days = sessionDaysBefore(bySymbol, ['s1'], '2026-11-10');
    return days.length === 1 && days[0] === '2026-11-09';
  });

  t('requires --side and --date rather than guessing them', () => {
    const a = parseArgs(['--date', '2026-11-10']);
    const b = parseArgs(['--side', 'losers']);
    return a.ok === false && /--side/.test(a.reason) && b.ok === false && /--date/.test(b.reason);
  });
  t('refuses an unknown flag instead of ignoring it', () => /unknown flag/.test(parseArgs(['--side', 'losers', '--date', '2026-11-10', '--typo']).reason));
  t('refuses --examine smaller than --top', () => parseArgs(['--side', 'losers', '--date', '2026-11-10', '--top', '10', '--examine', '3']).ok === false);
  t('parses the documented invocation into the expected plan', () => {
    const r = parseArgs(['--side', 'losers', '--date', '2026-11-10', '--dry-run', '--top', '10']);
    return r.ok && r.plan.name === 'movers-losers-2026-11-10' && r.plan.dryRun === true && r.plan.top === 10 && r.plan.examine === 30;
  });
  t('derives --examine from --top when it is not given', () => parseArgs(['--side', 'losers', '--date', '2026-11-10', '--top', '4']).plan.examine === 14);
  t('defaults to a real build (dry-run must be asked for)', () => parseArgs(['--side', 'losers', '--date', '2026-11-10']).plan.dryRun === false);

  t('the note records the screen, the counts and every exclusion', () => {
    const note = buildNote({
      side: 'losers',
      answerDate: '2026-11-10',
      rankedUniverse: 71,
      unranked: 414,
      examined: 18,
      accepted: [{ ticker: 'NXXT', pct: -92.7 }],
      excluded: [{ ticker: 'SHFS', rule: 'scale-mismatch', detail: '5m/daily 0.54x' }],
      window: { from: '2026-11-03', sessions: 5, short: false },
    });
    return /Top 1 usable losers/.test(note) && /71 symbol/.test(note) && /18 candidate/.test(note)
      && /Excluded: SHFS \(5m\/daily 0\.54x\)/.test(note) && /2026-11-03 to 2026-11-10/.test(note)
      && /414 further symbol/.test(note);
  });
  t('the note flags a short warm-up rather than staying silent', () => {
    const note = buildNote({
      side: 'winners', answerDate: '2026-11-11', rankedUniverse: 60, unranked: 0, examined: 10,
      accepted: [{ ticker: 'NXXT', pct: 809.1 }], excluded: [],
      window: { from: '2026-11-06', sessions: 2, short: true },
    });
    return /Only 2 prior session/.test(note);
  });

  return runCases(cases, 'build-movers-dataset');
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The run
// ══════════════════════════════════════════════════════════════════════════════════════════════

function usage() {
  console.log(`
  build-movers-dataset.cjs — build a movers-{winners|losers}-YYYY-MM-DD day list from stored bars (#1322)

    --side winners|losers   REQUIRED. Which end of the day's movers the list holds.
    --date YYYY-MM-DD       REQUIRED. The ONE session this list is a screen of (the answer day).
    --top N                 Symbols to keep (default 10).
    --examine N             Candidates to examine before giving up (default max(3*top, top+10)).
    --min-price X           Skip candidates closing below X (default 0 = off).
    --series-tolerance PP   Max gap, in percentage points, between the 5m and daily move for one
                            session before the two series are judged inconsistent (default 25).
    --universe stocks|all   'stocks' (default) screens symbol.type='stock'; 'all' screens every symbol.
    --active-only           Screen only symbol.active = 1.
    --dry-run               Print the same plan and write NOTHING (no rows, no imports).
    --no-import             Write/refresh rows but do not fetch bars.
    --prune                 Remove rows in this dataset that the current screen does not accept.
    --base-url URL          API base for the bar import (default http://localhost:3201).
    --lookback-days N       Days of bars read before the answer day (default ${DEFAULT_LOOKBACK_DAYS}).
    --self-test             Prove the validation logic can fail.
    --help                  This text.
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.length === 0) return usage();
  if (argv.includes('--self-test')) return process.exit(selfTest());

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(`\n[build-movers] ✖ ${parsed.reason}\n`);
    process.exit(2);
  }
  const plan = parsed.plan;

  // The contract cross-check. A missing build is SKIPPED and said out loud, never counted as a pass.
  const contract = loadCompiledContract();
  if (!contract?.parseMoversDatasetName) {
    console.log('[build-movers] ⚠️ SKIPPED contract cross-check: no compiled movers-dataset.js in dist/.');
  } else {
    const check = contract.parseMoversDatasetName(plan.name);
    if (!check.value) {
      console.error(`[build-movers] ✖ the service would REFUSE this name: ${check.reason}`);
      process.exit(2);
    }
  }

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const modal = plan.dryRun ? 'DRY RUN — nothing will be written' : plan.noImport ? 'APPLY (no bar import)' : 'APPLY';
    console.log(`[build-movers] ${plan.name}`);
    console.log(`[build-movers] side ${plan.side} · answer day ${plan.answerDate} · top ${plan.top} · examine ${plan.examine} · ${modal}`);
    console.log(`[build-movers] universe: ${plan.universe === 'all' ? 'every symbol' : "symbol.type='stock'"}${plan.activeOnly ? ', active only' : ''}\n`);

    // ── 1. the universe ──────────────────────────────────────────────────────────────────────
    const universeWhere = {};
    if (plan.universe === 'stocks') universeWhere.type = 'stock';
    if (plan.activeOnly) universeWhere.active = true;
    const universe = await prisma.symbol.findMany({
      where: universeWhere,
      select: { id: true, ticker: true, type: true, active: true },
    });
    const byId = new Map(universe.map((s) => [s.id, s]));
    console.log(`[build-movers] universe: ${universe.length} symbol(s) (${universe.filter((s) => s.active).length} active)`);

    // ── 2. stored bars around the answer day ────────────────────────────────────────────────
    // ⚠️ BOUNDED BY THE timestamp INDEX. `marketbar` holds ~2.0M rows / 482 MB; a timeframe-only
    // query is a full scan that measured 335 s on this machine. The window is what makes this usable.
    const answer = new Date(`${plan.answerDate}T00:00:00Z`);
    const from = new Date(answer.getTime() - plan.lookbackDays * 86400000);
    const to = new Date(answer.getTime() + 2 * 86400000);
    const t0 = Date.now();
    const bars = await prisma.marketBar.findMany({
      where: { timestamp: { gte: from, lt: to }, timeframe: { in: RANK_TIMEFRAMES } },
      select: { symbolId: true, timeframe: true, timestamp: true, close: true },
      orderBy: { timestamp: 'asc' },
    });
    console.log(`[build-movers] read ${bars.length} bar(s) in ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} (${Date.now() - t0} ms)`);

    const bySymbol = collectSessions(bars.filter((b) => byId.has(b.symbolId)));
    const moves = movesFor(bySymbol, plan.answerDate);
    const ranked = rankMoves(moves, plan.side);
    // Two different gaps, reported separately — "no bars at all" and "bars but no usable close
    // pair" are different findings, and collapsing them would hide the one that is a data defect.
    const noBarsAtAll = universe.length - bySymbol.size;
    const notRankable = universe.length - moves.length;
    console.log(`[build-movers] ${moves.length} symbol(s) had a session close on the answer day and a previous one`);
    if (notRankable > 0) {
      console.log(
        `[build-movers] ${notRankable} of ${universe.length} universe symbol(s) could not be ranked ` +
          `(${noBarsAtAll} had no bars in the window at all; ${notRankable - noBarsAtAll} had bars but no usable close pair) — see #1321`,
      );
    }
    if (!ranked.length) {
      console.error(`[build-movers] ✖ nothing to rank. No ${plan.universe === 'all' ? 'symbol' : 'stock'} in the universe has a stored session close for ${plan.answerDate}.`);
      console.error('[build-movers]   Capture daily bars for the universe first (#1321), or pick a day inside captured coverage.');
      process.exit(1);
    }

    // ── 3. examine in rank order, accept the first `top` that pass ──────────────────────────
    const examined = [];
    const accepted = [];
    const excluded = [];
    for (const c of ranked.slice(0, plan.examine)) {
      const sym = byId.get(c.symbolId);
      const verdict = evaluateCandidate(c, plan);
      const row = { ...c, ticker: sym?.ticker ?? c.symbolId };
      examined.push(row);
      if (verdict.accepted) {
        accepted.push({ ...row, scale: verdict.scale });
      } else {
        excluded.push({ ...row, rule: verdict.rule, detail: verdict.detail });
      }
      if (accepted.length >= plan.top) break;
    }

    if (!accepted.length) {
      console.error(`\n[build-movers] ✖ no candidate passed the checks — nothing would be written.`);
      for (const e of excluded) console.error(`    ${e.ticker.padEnd(6)} ${e.rule}: ${e.detail}`);
      process.exit(1);
    }

    // ── 4. the warm-up window, derived from the accepted symbols' own sessions ─────────────
    // ⚠️ THE CALENDAR IS BUILT FROM THE DATASET'S OWN SERIES, FROM STOCKS ONLY.
    //   · crypto trades Saturday and Sunday, so a calendar taken from every ranked symbol puts
    //     11-07/11-08 into an equities week;
    //   · a `1d`-series symbol is stamped on a rolling 24h boundary, which plants bars on weekends
    //     (measured: AIR holds a 1d bar stamped 2026-11-08, a Sunday).
    // Both inflate `sessionsBack` and report an ordinary Friday→Monday move as spanning four
    // sessions. Measured 2026-11-21 on the first build, which is why the filter exists.
    const ofType = (t) => moves.filter((m) => String(byId.get(m.symbolId)?.type ?? '').toLowerCase() === t);
    const inSeries = (list) => list.filter((m) => m.source === DATASET_TIMEFRAME).map((m) => m.symbolId);
    const stockIds = ofType('stock').length ? ofType('stock') : moves;
    const calendarIds = inSeries(stockIds).length
      ? inSeries(stockIds)
      : inSeries(moves).length
        ? inSeries(moves)
        : stockIds.map((m) => m.symbolId);
    const marketDays = sessionDaysBefore(bySymbol, calendarIds, plan.answerDate);
    for (const a of accepted) {
      a.sessionsBack = sessionsBackOf(a.prevDay, plan.answerDate, marketDays);
    }
    const daysBefore = sessionDaysBefore(bySymbol, accepted.map((a) => a.symbolId), plan.answerDate);
    const window = warmupStart(daysBefore, plan.answerDate);
    const fromDate = window.from ? new Date(`${window.from}T00:00:00Z`) : answer;
    const toDate = new Date(answer.getTime() + 86400000);
    if (window.short) {
      console.log(`[build-movers] ⚠️ only ${window.sessions} prior session(s) are stored (the convention is ${WARMUP_SESSIONS}) — recorded in the note`);
    }

    // ── 5. print the plan exactly as it will be written ────────────────────────────────────
    console.log(`\n[build-movers] === accepted (${accepted.length}) ===`);
    console.log(`  ${'ticker'.padEnd(7)} ${'move%'.padStart(9)}  ${'close'.padStart(10)}  ${'prevDay'.padEnd(10)}  back  source  scale`);
    for (const a of accepted) {
      console.log(
        `  ${a.ticker.padEnd(7)} ${a.pct.toFixed(1).padStart(9)}  ${a.close.toFixed(4).padStart(10)}  ` +
          `${a.prevDay.padEnd(10)}  ${String(a.sessionsBack ?? 1).padStart(4)}  ${a.source.padEnd(6)}  ${a.scale}`,
      );
    }
    if (excluded.length) {
      console.log(`\n[build-movers] === excluded (${excluded.length}) ===`);
      for (const e of excluded) {
        console.log(`  ${e.ticker.padEnd(7)} ${e.rule.padEnd(28)} ${e.detail}`);
      }
    }

    const note = buildNote({
      side: plan.side,
      answerDate: plan.answerDate,
      top: plan.top,
      rankedUniverse: moves.length,
      unranked: notRankable,
      examined: examined.length,
      accepted,
      excluded,
      window,
      spans: accepted,
    });
    console.log(`\n[build-movers] window: ${fromDate.toISOString()} → ${toDate.toISOString()} · ${DATASET_TIMEFRAME}`);
    console.log(`[build-movers] note: ${note}\n`);

    if (plan.dryRun) {
      console.log('[build-movers] DRY RUN — no rows written, no bars imported.');
      console.log(`[build-movers] re-run without --dry-run to create ${accepted.length} row(s) under '${plan.name}'.`);
      return;
    }

    // ── 6. write the rows (find-first: there is no unique key on name+symbolId+timeframe) ──
    let created = 0;
    let updated = 0;
    const targetIds = [];
    for (const a of accepted) {
      const existing = await prisma.backtestPeriod.findMany({
        where: { name: plan.name, symbolId: a.symbolId, timeframe: DATASET_TIMEFRAME },
        select: { id: true, fromDate: true, toDate: true },
      });
      if (existing.length > 1) {
        console.log(`  ⚠️ ${a.ticker}: ${existing.length} rows already named ${plan.name} — duplicates left alone, reported`);
      }
      if (existing.length) {
        await prisma.backtestPeriod.update({
          where: { id: existing[0].id },
          data: { fromDate, toDate, note },
        });
        updated++;
        targetIds.push({ ticker: a.ticker, id: existing[0].id, action: 'updated' });
      } else {
        const row = await prisma.backtestPeriod.create({
          data: { name: plan.name, note, symbolId: a.symbolId, timeframe: DATASET_TIMEFRAME, fromDate, toDate },
          select: { id: true },
        });
        created++;
        targetIds.push({ ticker: a.ticker, id: row.id, action: 'created' });
      }
    }
    console.log(`[build-movers] rows: ${created} created · ${updated} updated`);

    // ── 6b. the group must hold exactly the accepted set ───────────────────────────────────
    // ⚠️ A RE-RUN WHOSE SCREEN CHANGES DOES NOT REPLACE THE OLD PICKS. Nothing here has a unique key,
    // and an excluded symbol from an earlier run keeps its row — measured 2026-11-21: the first build
    // of `movers-losers-2026-11-09` left 12 rows in a `--top 10` group after two symbols were
    // accepted on the second run and two were not. So the extras are REPORTED, and removed only when
    // `--prune` is asked for: deleting a row someone else created is not a default.
    const groupRows = await prisma.backtestPeriod.findMany({
      where: { name: plan.name },
      select: { id: true, symbolId: true },
    });
    const acceptedIds = new Set(accepted.map((a) => a.symbolId));
    const extras = groupRows.filter((r) => !acceptedIds.has(r.symbolId));
    if (extras.length && !plan.prune) {
      console.log(
        `[build-movers] ⚠️ ${extras.length} row(s) in '${plan.name}' are NOT in the accepted set: ` +
          `${extras.map((r) => byId.get(r.symbolId)?.ticker ?? r.symbolId).join(', ')}`,
      );
      console.log('[build-movers]   the group therefore holds more than the top N — re-run with --prune to remove them');
    }
    if (extras.length && plan.prune) {
      console.log(`\n[build-movers] === pruning ${extras.length} row(s) the screen no longer accepts ===`);
      for (const r of extras) {
        const ticker = byId.get(r.symbolId)?.ticker ?? r.symbolId;
        const runs = await prisma.backtestRun.count({ where: { periodId: r.id } });
        if (runs > 0) {
          console.log(`  ⚠️ kept ${ticker}: ${runs} backtest run(s) reference this period — deleting it would orphan them`);
          continue;
        }
        await prisma.backtestPeriod.delete({ where: { id: r.id } });
        console.log(`  − removed ${ticker}`);
      }
    }

    // ── 7. capture the 5m bars through the EXISTING import route ───────────────────────────
    if (plan.noImport) {
      console.log('[build-movers] --no-import: bars not fetched. `barCount` stays whatever it was.');
    } else {
      console.log(`\n[build-movers] === 5m capture (POST ${plan.baseUrl}/api/backtest/periods/:id/import) ===`);
      for (const target of targetIds) {
        let line;
        try {
          const res = await fetch(`${plan.baseUrl}/api/backtest/periods/${target.id}/import`, {
            method: 'POST',
            signal: AbortSignal.timeout(180000),
          });
          const body = await res.json().catch(() => null);
          if (!res.ok) {
            line = `✖ HTTP ${res.status} — ${JSON.stringify(body).slice(0, 200)}`;
          } else if (!body) {
            line = '✖ answered 200 with no JSON body — cannot judge the import';
          } else {
            line = `${body.outcome} · fetched ${body.fetched} · inserted ${body.inserted} · already present ${body.alreadyPresent} · window holds ${body.barsAfter}`;
            if (body.outcome !== 'imported') {
              line += ` · ⚠️ NOT a capture: ${(body.findings ?? []).join(' | ')}`;
            }
          }
        } catch (err) {
          line = `✖ ${err?.message ?? err} — is the API up on ${plan.baseUrl}?`;
        }
        console.log(`  ${target.action === 'created' ? '+' : '~'} ${target.ticker.padEnd(7)} ${line}`);
      }
    }

    // ── 8. what the API will now report ───────────────────────────────────────────────────
    const rows = await prisma.backtestPeriod.findMany({
      where: { name: plan.name },
      select: { timeframe: true, barCount: true, provider: true, symbol: { select: { ticker: true } } },
    });
    const withBars = rows.filter((r) => (r.barCount ?? 0) > 0).length;
    console.log(`\n[build-movers] ✅ ${plan.name}: ${rows.length} row(s), ${withBars} holding bars, timeframe(s) ${[...new Set(rows.map((r) => r.timeframe))].join(',')}`);
    console.log(`[build-movers] verify with:  curl -s ${plan.baseUrl}/api/backtest/movers-datasets`);
    if (withBars < rows.length) {
      console.log(`[build-movers] ⚠️ ${rows.length - withBars} row(s) hold no bars yet — 'barCount: null' means never imported, 0 means the window is empty.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`[build-movers] ✖ ABORT: ${err?.message ?? err}`);
  process.exit(2);
});
