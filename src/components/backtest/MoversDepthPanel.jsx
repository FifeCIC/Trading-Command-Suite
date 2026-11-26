/**
 * MoversDepthPanel — ONE session, taken apart: the ladder, the bars, the decisions, the decomposition.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * A result row said "NXXT moved +430% at the cutoff, the strategy won 36% of its trades". Nothing in
 * the output explained the gap: a run keeps one composite per bar and a trade count, and the two were
 * never on the same axis. This panel puts them on one axis and links them, so "which bar, which
 * signal, which decision, which exit" is a place the reader can point at.
 *
 * ── WHAT IS RECORDED AND WHAT IS DERIVED (the honesty rule) ─────────────────────────────────────
 * RECORDED by the run, unchanged: bar instant, price, change against the previous session's close,
 * both scores, the risk multiplier, the signal class, the bar-gate verdict, and every trade's entry,
 * exit, direction, P/L and exit reason.
 * DERIVED on the server (`run-depth.ts`), and labelled: each bar's STATE and the ladder counts.
 * ⚠️ NOT AVAILABLE: the engine does not record WHY a bar with an actionable signal produced no trade.
 * Those rows say so in words. Do not "improve" the wording into a guess.
 *
 * ── THE TWO TABLES ARE ONE TIMELINE ─────────────────────────────────────────────────────────────
 * A bar row can be pinned, the decomposition below follows it, and the pinned instant is marked in the
 * bars table.
 *
 * ⚠️ #1333 — A BIDIRECTIONAL LINK WAS BUILT HERE ON 2026-11-23 AND REVERSED THE SAME DAY. The ask was
 * *"sync … so that the related row is displayed within each table"*, which was implemented as: a pin
 * marks every trade whose entry or exit shares the instant, and marks the exit bar of a pinned trade.
 * Owner, after using it: *"It's highlighting two rows at a time in the first table and in different
 * styles, sometimes three rows in the second table. All very distracting."*
 *
 * ⚠️ **THE LESSON IS ABOUT COUNT, NOT ABOUT CORRECTNESS.** The rows it marked really were related — the
 * measurement held (54 bars, 63 trades, 55 entries and 57 exits landing on a bar clock). But one hover
 * lighting 2–3 rows in each table turns a table you are READING into a table you are watching, and this
 * page is read for hours. **A hover affordance must mark one row, or none.** Do not rebuild this without
 * a way to keep the marked set at exactly one row in each table.
 */
import { useMemo, useState } from 'react';
import WhyPopover from '../WhyPopover.jsx';
import MoversDepthChart from './MoversDepthChart.jsx';
import { formatPct, formatPrice, formatAmount } from '../../core/format-utils';



/** `2026-11-11T15:35:00.000Z` → `15:35` (UTC — the whole page runs on the UTC cutoff). */
const clock = (iso) => (typeof iso === 'string' && iso.length >= 16 ? iso.slice(11, 16) : '—');

const STATE_LABEL = {
  'entry+exit': 'ENTRY + EXIT',
  entry: 'ENTRY',
  exit: 'EXIT',
  'signal-not-traded': 'SIGNAL · NO TRADE',
  'bar-gate': 'BLOCKED BY BAR',
  'no-data': 'NO READING',
  quiet: 'HOLD',
};

/**
 * What each badge MEANS, in one sentence — so the reader never has to infer it. Each sentence describes
 * ONE BAR. The column holds a badge per bar; it is not a trade's story, and saying so is the whole point
 * of this map (raised on 2026-11-21: how a bar could be both ENTRY and EXIT).
 */
const STATE_HINT = {
  'entry+exit': 'A trade opened on this bar AND closed on this bar — a same-bar bracket hit (TP or SL inside the 5 minutes).',
  entry: 'A trade opened on this bar and was still open at its end.',
  exit: 'A trade closed on this bar, and nothing opened on it.',
  'signal-not-traded': 'The signal was actionable but no trade opened, and the engine records no per-bar reason.',
  'bar-gate': 'The score did not clear the bot’s own entry bar, so the signal was never acted on.',
  'no-data': 'No directional reading on this bar.',
  quiet: 'Not actionable for this protocol’s side.',
};

const STATE_TONE = {
  'entry+exit': 'entry',
  entry: 'entry',
  exit: 'exit',
  'signal-not-traded': 'warn',
  'bar-gate': 'gate',
  'no-data': 'none',
  quiet: 'none',
};

/**
 * An exit reason carries a tone, so a stop-out and a target are distinguishable at a glance.
 *
 * ⚠️ EVERY REASON THE ENGINE CAN RETURN IS MAPPED. An unmapped reason falls through to `none`, which
 * is also EOD's tone — so "the session clock closed this trade" would have rendered as the same
 * non-event as "the data ran out". #1242 added the live vocabulary's two newest closes:
 * `TARGET` (`system:take-profit`) and `SESSION` (`system:session-exit`).
 */
const EXIT_TONE = {
  TP: 'entry',
  TARGET: 'entry',
  SL: 'bad',
  TIME: 'warn',
  SESSION: 'session',
  TRAIL: 'exit',
  EOD: 'none',
};

/** Reasons whose stored code is a system/engine token rather than a word a reader knows. */
const EXIT_LABEL = {
  TARGET: 'Take profit',
  SESSION: 'Session close',
};

const exitReasonText = (reason) => EXIT_LABEL[reason] ?? reason;

/**
 * The decision in words, using ONLY recorded facts.
 *
 * ⚠️ EVERY TRADE ON THE BAR IS NAMED, not just the first. A row showing "LONG opened at 0.96" beside an
 * `ENTRY + EXIT` badge leaves the exit unexplained — the row knew and the sentence did not (raised
 * 2026-11-21). An entry and a same-bar exit are ONE trade (the bracket closed inside the 5 minutes);
 * two different trades are joined with " · ".
 *
 * ⚠️ A PRE-CUTOFF TRADE IS NOT "REFUSED". The selection cannot refuse something that never reached it:
 * before the cutoff the ranking is not known yet, which is why `kept` is false on every one of them
 * (measured: all 34 pre-cutoff trades on movers-winners-2026-11-11 carried it). Calling that a refusal
 * invented a rejection reason, so the wording now names the real cause.
 */
function decisionText(bar) {
  if (bar.state === 'entry' || bar.state === 'entry+exit') {
    const parts = [];
    const first = bar.entries[0];
    parts.push(`${first.direction} opened at ${formatPrice(bar.price)}`);
    if (bar.exits.length) {
      parts.push(exitPhrase(bar.exits[0]));
    } else if (bar.orphanedExits > 0) {
      // The trade left before the next bar. Saying "still open" here would be a contradiction with the
      // executions table, which is exactly the kind of quiet disagreement this panel exists to remove.
      parts.push('closed before the next bar it could be shown on');
    }
    if (bar.beforeCutoff) parts.push('before the cutoff — the ranking was not known yet');
    else if (bar.entries.some((x) => !x.kept)) parts.push('after the cutoff, refused by the selection');
    return parts.join(' · ');
  }
  if (bar.state === 'exit') {
    return exitPhrase(bar.exits[0]);
  }
  if (bar.state === 'signal-not-traded') {
    return `${bar.signal} cleared the gates and produced no trade — the engine does not record the per-bar reason`;
  }
  if (bar.state === 'bar-gate') {
    return `score ${bar.score} did not clear the bot's own entry bar`;
  }
  if (bar.state === 'no-data') return 'no directional reading on this bar';
  return `${bar.signal} — not actionable for this leg`;
}

/** `TP closed LONG for 471.75` — one phrasing, used by both the same-bar leg and a standalone exit. */
function exitPhrase(x) {
  return `${x.exitReason} closed ${x.direction} for ${formatAmount(x.pnl)}`;
}

/**
 * Why the selection did not count a trade, in words.
 *
 * ⚠️ ONE WORD WAS DOING TWO JOBS (2026-11-23, owner report): the row read `LONG refused` beside `Exit SL`.
 * That is not a contradiction — `kept: false` means the SELECTION did not count the trade, while the
 * engine still opened it, walked it and stopped it out. "refused" made it read as though the bot had
 * declined to trade and then exited a position it never had.
 */
const NOT_COUNTED = {
  // ⚠️ SHORT TAGS, not sentences. The owner's objection to the old wording (2026-11-23) was that a
  // floating sentence explained nothing: the same fact belongs in a COLUMN of a table, where it can be
  // counted and compared. The full definition is the column header's tooltip.
  'before-cutoff': 'before screen',
  'not-selected': 'not in list',
};

const NOT_COUNTED_HINT = {
  'before-cutoff': 'Entered before the screen time — the ranking had not been taken yet, so the day list could not have chosen it.',
  'not-selected': 'The day list chose other symbols instead of this one. The engine still opened, walked and closed the trade, so its P/L is real but is in no total on this page.',
};

/**
 * SelectionSummaryTable — WHAT THE DAY LIST COUNTED, per symbol (#1340).
 *
 * Owner, 2026-11-23: a sentence floating under a table said *"not counted — day list did not pick this
 * symbol"*, and the report was that this explains nothing. It does not, because it is one row's reason
 * with no denominator beside it: a reader cannot tell whether one trade or forty were excluded.
 *
 * So the same facts are a table — per symbol, how many rows the engine opened, how many the day list
 * counted, and how many fell out and why. ⚠️ The P/L columns are separated because that is the whole
 * point: an ignored trade's P/L is real and is in no total above.
 */
export function SelectionSummaryTable({ trades }) {
  if (!Array.isArray(trades) || trades.length === 0) return null;
  const bySymbol = new Map();
  for (const t of trades) {
    const key = t.symbol ?? '—';
    const row = bySymbol.get(key) ?? {
      symbol: key, opened: 0, counted: 0, beforeCutoff: 0, notSelected: 0, other: 0,
      pnlCounted: 0, pnlIgnored: 0,
    };
    row.opened += 1;
    const pnl = Number.isFinite(Number(t.pnl)) ? Number(t.pnl) : 0;
    if (t.kept) {
      row.counted += 1;
      row.pnlCounted += pnl;
    } else {
      row.pnlIgnored += pnl;
      if (t.selectionReason === 'before-cutoff') row.beforeCutoff += 1;
      else if (t.selectionReason === 'not-selected') row.notSelected += 1;
      // A reason nobody classified is COUNTED as `other` rather than dropped — an unclassified
      // exclusion that renders as nothing is the "plausible output, no error" shape.
      else row.other += 1;
    }
    bySymbol.set(key, row);
  }
  const rows = [...bySymbol.values()].sort((a, b) => b.pnlCounted - a.pnlCounted);
  const anyIgnored = rows.some((r) => r.opened !== r.counted);

  return (
    <>
      <p className="mvp-caption">
        What the day list counted. A row the engine opened but the selection did not admit has real
        P/L and is in no total on this page.
      </p>
      <div className="mvp-scroll">
      <table className="mvp-table">
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col" className="mvp-num">Opened</th>
            <th scope="col" className="mvp-num">Counted</th>
            <th scope="col" className="mvp-num" title={NOT_COUNTED_HINT['before-cutoff']}>Before screen</th>
            <th scope="col" className="mvp-num" title={NOT_COUNTED_HINT['not-selected']}>Not in list</th>
            {rows.some((r) => r.other > 0) && <th scope="col" className="mvp-num">Not classified</th>}
            <th scope="col" className="mvp-num">P/L counted</th>
            <th scope="col" className="mvp-num">P/L ignored</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <th scope="row" className="mvp-nowrap">{r.symbol}</th>
              <td className="mvp-num">{r.opened}</td>
              <td className="mvp-num">{r.counted}</td>
              <td className={`mvp-num ${r.beforeCutoff ? '' : 'mvp-muted'}`}>{r.beforeCutoff || '—'}</td>
              <td className={`mvp-num ${r.notSelected ? '' : 'mvp-muted'}`}>{r.notSelected || '—'}</td>
              {rows.some((x) => x.other > 0) && (
                <td className={`mvp-num ${r.other ? 'mvp-warn' : 'mvp-muted'}`}>{r.other || '—'}</td>
              )}
              <td className={`mvp-num ${r.pnlCounted > 0 ? 'mvp-pos' : r.pnlCounted < 0 ? 'mvp-neg' : 'mvp-muted'}`}>
                {formatAmount(r.pnlCounted)}
              </td>
              <td className={`mvp-num mvp-muted`}>{anyIgnored && r.pnlIgnored ? formatAmount(r.pnlIgnored) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

/**
 * ExecutionsTable — the per-trade record, ONE implementation for two views.
 *
 * ⚠️ EXTRACTED 2026-11-23 so the per-symbol panel and the merged all-symbols table cannot drift. The
 * owner's report was that the table showed executions that all looked like one instrument and did not
 * say which — so every row now carries its SYMBOL, and a row without one falls back to the panel's own.
 */
export function ExecutionsTable({ trades, symbol }) {
  if (!trades.length) {
    return <p className="mvp-note">The engine opened no trade on this session.</p>;
  }
  const notCounted = trades.filter((t) => !t.kept).length;
  return (
    <>
      <div className="mvp-scroll mvp-depth-scroll">
        <table className="mvp-table">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">In</th>
              <th scope="col" className="mvp-num">Price</th>
              <th scope="col">Out</th>
              <th scope="col" className="mvp-num">Price</th>
              <th scope="col">Side</th>
              <th scope="col" className="mvp-num">Bars</th>
              <th scope="col">Exit</th>
              <th scope="col" className="mvp-num">P/L</th>
            </tr>
          </thead>
          <tbody>
            {[...trades]
              .sort((a, b) => String(a.entryDate).localeCompare(String(b.entryDate)))
              .map((t, i) => {
                const span = Math.max(
                  0,
                  Math.round((new Date(t.exitDate) - new Date(t.entryDate)) / 300_000),
                );
                return (
                  <tr key={`${t.symbol ?? symbol ?? ''}-${t.entryDate}-${i}`} className={t.kept ? '' : 'mvp-config-row--ignored'}>
                    <td className="mvp-nowrap">{t.symbol || symbol || '—'}</td>
                    <td className="mvp-nowrap">{clock(t.entryDate)}</td>
                    <td className="mvp-num">{formatPrice(t.entryPrice)}</td>
                    <td className="mvp-nowrap">{clock(t.exitDate)}</td>
                    <td className="mvp-num">{formatPrice(t.exitPrice)}</td>
                    <td className="mvp-nowrap mvp-muted">
                      {t.direction}
                      {!t.kept && (
                        <span
                          className="mvp-depth-pre"
                          title={NOT_COUNTED_HINT[t.selectionReason] ?? 'The selection did not count this trade.'}
                        >
                          {NOT_COUNTED[t.selectionReason] ?? 'not counted'}
                        </span>
                      )}
                    </td>
                    <td className="mvp-num">{span}</td>
                    <td className="mvp-nowrap">
                      <span
                        className={`mvp-state mvp-state--${EXIT_TONE[t.exitReason] ?? 'none'}`}
                        title={t.exitReason}
                      >
                        {exitReasonText(t.exitReason)}
                      </span>
                    </td>
                    <td
                      className={`mvp-num ${t.kept && t.pnl > 0 ? 'mvp-pos' : t.kept && t.pnl < 0 ? 'mvp-neg' : 'mvp-muted'}`}
                      title={t.kept ? undefined : 'this trade is NOT in any total on the page'}
                    >
                      {formatAmount(t.pnl)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {notCounted > 0 && (
        /**
         * ⚠️ THIS WAS A SENTENCE AND IS NOW A TABLE (owner, 2026-11-23). The sentence named one reason
         * with no denominator, so a reader could not tell whether one trade or forty had been excluded —
         * and it floated under the table rather than sitting beside the numbers it described.
         */
        <SelectionSummaryTable trades={trades} />
      )}
    </>
  );
}

/**
 * DecisionsTable — WHAT THE PIPELINE DID ON EVERY BAR, in one row per bar.
 *
 * Owner, 2026-11-23: META.Stack records signals and bot decisions, and those are needed on this page as a
 * row of decisions — "REFUSED" is not good enough, because a day has to be understandable as it unfolds.
 *
 * ⚠️ EVERY COLUMN HERE ALREADY EXISTED IN THE PAYLOAD — this is a RENDERER, not a second scoring path.
 * `detail.bars` carries the composite `score`, the directional/opportunity split, the risk multiplier, the
 * signal class, `passedBar`, and every directive's own `score`/`signalClass`/`reason`/`inSignal`. Nothing
 * is recomputed and no threshold is re-invented: a bar is judged by the same numbers the engine used,
 * including `passedBar`, which is the engine's OWN verdict on the entry gate.
 *
 * ⚠️ THE THREE STATES THAT USED TO LOOK ALIKE: a bar with no score, a bar that scored but was under the
 * bar, and a bar that scored, passed, and still produced no trade. They are separate rows here because
 * they mean three different things about the day.
 */
export function DecisionsTable({ bars, cutoffUtc }) {
  const rows = Array.isArray(bars) ? bars : [];
  if (!rows.length) {
    return <p className="mvp-note">No scored bars were returned for this session.</p>;
  }

  /** The directive that did most of the work on this bar, and its own sentence. */
  const why = (b) => {
    const ds = (b.directives ?? []).filter((d) => d && typeof d.score === 'number');
    if (!ds.length) return b.signal || 'no directive detail on this bar';
    const top = [...ds].sort((a, b2) => (b2.score ?? 0) - (a.score ?? 0))[0];
    const counted = top.inSignal === false ? ' (read, not counted in direction)' : '';
    return `${top.directiveId} ${top.score}/${top.maxScore}${counted}${top.reason ? ` — ${top.reason}` : ''}`;
  };

  const decide = (b) => {
    if (b.state === 'no-data') {
      return { label: 'NO DATA', tone: 'none', why: 'no bar to judge — the series has a hole here' };
    }
    const entered = (b.entries ?? []).length > 0;
    const exited = (b.exits ?? []).length > 0;
    if (entered && exited) return { label: 'ENTER + EXIT', tone: 'entry', why: why(b) };
    if (entered) return { label: 'ENTER', tone: 'entry', why: why(b) };
    if (exited) {
      const reason = (b.exits ?? []).map((e) => e.exitReason).filter(Boolean).join(' · ');
      return { label: `EXIT ${reason}`.trim(), tone: 'warn', why: why(b) };
    }
    if (b.passedBar) {
      return {
        label: 'SIGNAL — NO TRADE',
        tone: 'warn',
        why: `${why(b)} · cleared the entry bar, but the engine opened nothing (already in a position, or unaffordable)`,
      };
    }
    return { label: 'SKIP — UNDER BAR', tone: 'none', why: why(b) };
  };

  return (
    <div className="mvp-scroll mvp-depth-scroll">
      <table className="mvp-table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col" className="mvp-num">Score</th>
            <th scope="col" className="mvp-num">Dir %</th>
            <th scope="col" className="mvp-num">Opp %</th>
            <th scope="col" className="mvp-num">Risk ×</th>
            <th scope="col">Signal</th>
            <th scope="col">Decision</th>
            <th scope="col">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b, i) => {
            const d = decide(b);
            return (
              <tr key={`${b.time}-${i}`} className={b.beforeCutoff ? 'mvp-config-row--ignored' : ''}>
                <td className="mvp-nowrap">
                  {clock(b.time)}
                  {b.beforeCutoff && cutoffUtc ? (
                    <span className="mvp-depth-pre" title={`before the ${cutoffUtc} screen — context, not a decision`}>
                      pre-screen
                    </span>
                  ) : null}
                </td>
                <td className="mvp-num">{Math.round(b.score ?? 0)}</td>
                <td className="mvp-num">{b.signalPct == null ? '—' : Number(b.signalPct).toFixed(1)}</td>
                <td className="mvp-num">{b.opportunityPct == null ? '—' : Number(b.opportunityPct).toFixed(1)}</td>
                <td className="mvp-num">{b.riskMultiplier == null ? '—' : Number(b.riskMultiplier).toFixed(2)}</td>
                <td className="mvp-nowrap mvp-muted">{b.signal || '—'}</td>
                <td className="mvp-nowrap">
                  <span className={`mvp-state mvp-state--${d.tone}`}>{d.label}</span>
                </td>
                <td className="mvp-config-note">{d.why}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function MoversDepthPanel({ symbol, day, detail }) {
  const [pinned, setPinned] = useState(null);

  const bars = useMemo(() => detail?.bars ?? [], [detail]);
  const steps = useMemo(() => detail?.steps ?? [], [detail]);
  const trades = useMemo(() => detail?.trades ?? [], [detail]);
  /** The day-list size, read off the ladder's own first rung before that rung is dropped below. */
  const candidatesTotal = steps.find((s) => s.id === 'candidates')?.count ?? 0;

  const focused = useMemo(
    () => bars.find((b) => b.time === pinned) ?? bars.find((b) => b.state !== 'quiet' && b.state !== 'no-data') ?? bars[0] ?? null,
    [bars, pinned],
  );
  const focusTime = focused?.time ?? null;

  if (!bars.length) {
    return (
      <p className="mvp-note">
        No per-bar detail was returned for {symbol}. The run reported no scored bars on {day}, which is
        different from “nothing happened” — it means the window held no bars this engine could read.
      </p>
    );
  }

  /**
   * The ONE row a pin marks — the bar itself. ⚠️ Not a set: a hover that lights two or three rows in
   * each table was rejected by the owner on sight (#1333), and the count was the problem, not the rule.
   */
  const rowClass = (time) => `mvp-depth-row${time === focusTime ? ' mvp-depth-row--on' : ''}`;

  return (
    <div className="mvp-depth">
      {/* ── 1 · the funnel, as square cards ─────────────────────────────────────────────────────── */}
      <section id="mvp-sec-ladder" aria-label="Pipeline steps">
        {/* ⚠️ NO HEADING AND NO RUN-COUNTER PARAGRAPH (decided 2026-11-20). The paragraph was judged
            clutter, and the stored run id was not yet of use to a reader. The symbol and day are already
            in the panel's own chip bar above; repeating them as an h3 was the clutter. */}
        {/* ⚠️ SQUARE CARDS, NOT A LADDER WITH BARS. The progress bars claimed a "loading" shape for counts
            that were never loading. Two rungs were also redundant: the single symbol was already
            highlighted in the day table, and its "of N" came from that same list. Both are dropped; the
            first card carries the list size so the denominator is not lost. Each card explains itself on
            hover (and on click / keyboard for touch and screen readers). */}
        <ol className="mvp-step-cards">
          {steps
            .filter((s) => s.id !== 'candidates' && s.id !== 'selected')
            .map((s) => (
              <li key={s.id} className="mvp-step-card">
                <span className="mvp-step-head">
                  <span className="mvp-step-count">{s.count}</span>
                  {s.of != null && <span className="mvp-step-of">of {s.of}</span>}
                </span>
                <span className="mvp-step-label">
                  {s.label}
                  <WhyPopover title={`What “${s.label}” counts`} hover>
                    {s.note}
                    {s.id === 'scored' && candidatesTotal > 0 && (
                      <> Read against the {candidatesTotal}-symbol list this session started from.</>
                    )}
                  </WhyPopover>
                </span>
              </li>
            ))}
        </ol>
        {/* The run-counters paragraph (with the stored-run id) was removed 2026-11-20 — it was judged
            clutter, and the run id was not yet of use to a reader. The per-symbol counters remain on the
            ladder cards above (signals / no-trade / refused); the raw `runCounters` object is still on
            `detail` for diagnostics. */}
      </section>

      {/* ── 2 · ONE timeline: the score, the reading, and the outcome on the same row ─────────────
          ⚠️ THIS WAS TWO TABLES AND THE READER WAS RIGHT THAT THEY WERE NEAR-IDENTICAL (2026-11-20):
          both listed the same bars with the same time and the same P/L repeated, differing only in
          which columns they carried. They are merged here, and the SCORE table keeps only score-side
          facts (State was removed — it labels the OUTCOME, not the reading) while the DECISION reason
          joins the row as a column. Executions stay a separate table because they are one row per
          TRADE, not per bar. */}
      {/* ── 2 · the session as a picture, before the tables that detail it ─────────────────────── */}
      <MoversDepthChart bars={bars} trades={trades} pinTime={pinned} symbol={symbol} />

      <section id="mvp-sec-bars" aria-label="Bars, scores and decisions">
        <h3 className="mvp-depth-title">Bars &amp; decisions <span className="mvp-muted">(UTC)</span></h3>
        <div className="mvp-scroll mvp-depth-scroll">
          <table className="mvp-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col" className="mvp-num">Price</th>
                <th scope="col" className="mvp-num">Chg %</th>
                <th scope="col" className="mvp-num">Score</th>
                <th scope="col" className="mvp-num">Opportunity</th>
                <th scope="col" className="mvp-num">Risk</th>
                <th scope="col">Signal</th>
                <th scope="col">Decision</th>
                <th scope="col">Why / what</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr
                  key={b.time}
                  className={`${rowClass(b.time)}${b.beforeCutoff ? ' mvp-depth-row--pre' : ''}`}
                  onMouseEnter={() => setPinned(b.time)}
                  onFocus={() => setPinned(b.time)}
                  tabIndex={0}
                  onClick={() => setPinned(b.time)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPinned(b.time);
                    }
                  }}
                >
                  <td className="mvp-nowrap">
                    {clock(b.time)}
                    {b.beforeCutoff && <span className="mvp-depth-pre" title="before the cutoff — could never trade">pre</span>}
                  </td>
                  <td className="mvp-num">{formatPrice(b.price)}</td>
                  <td className={`mvp-num ${b.changePct > 0 ? 'mvp-pos' : b.changePct < 0 ? 'mvp-neg' : ''}`}>
                    {formatPct(b.changePct)}
                  </td>
                  <td className="mvp-num">{Number(b.score).toFixed(1)}</td>
                  <td className="mvp-num">{Number(b.opportunityPct).toFixed(1)}</td>
                  <td className="mvp-num">{Number(b.riskMultiplier).toFixed(2)}</td>
                  <td className="mvp-nowrap">{b.signal}</td>
                  <td className="mvp-nowrap">
                    {/* The badge carries its own definition in a tooltip AND in the text alternative, so the
                        three labels cannot be read as contradictory statements about one trade. */}
                    <span
                      className={`mvp-state mvp-state--${STATE_TONE[b.state] ?? 'none'}`}
                      title={STATE_HINT[b.state] ?? undefined}
                    >
                      {STATE_LABEL[b.state] ?? b.state}
                    </span>
                  </td>
                  <td>{decisionText(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 3 · executions — the per-trade record the phases need ─────────────────────────────── */}
      <section id="mvp-sec-execution" aria-label="Executions">
        <h3 className="mvp-depth-title">
          Executions <span className="mvp-muted">({trades.length} the engine took · {trades.filter((t) => !t.kept).length} not counted)</span>
        </h3>
        <ExecutionsTable trades={trades} symbol={symbol} />
      </section>

      {/* ── 4 · decisions — one row per bar, the pipeline's own verdict ────────────────────────── */}
      <section id="mvp-sec-decisions" aria-label="Decisions">
        <h3 className="mvp-depth-title">
          Decisions <span className="mvp-muted">· every bar, in order · {symbol}</span>
        </h3>
        <DecisionsTable bars={bars} cutoffUtc={detail?.cutoffUtc} />
      </section>

      {/* ── 4 · the decomposition of the pinned bar ────────────────────────────────────────────── */}
      <section id="mvp-sec-directives" aria-label="Directive breakdown">
        <h3 className="mvp-depth-title">
          Why {focused ? clock(focused.time) : '—'} scored {focused ? Number(focused.score).toFixed(1) : '—'}
        </h3>

        {!focused?.directives?.length ? (
          <p className="mvp-note">
            This run did not return a directive breakdown. Only a run made with <code>includeBreakdown</code>{' '}
            records one — re-run with the detail switch on.
          </p>
        ) : (
          <>
            {focused.groups && Object.keys(focused.groups).length > 0 && (
              <div className="mvp-group-row" id="mvp-sec-protocol">
                {Object.entries(focused.groups).map(([id, pct]) => {
                  // Count THIS group's directives on the pinned bar, so the explanation states real
                  // numbers rather than a definition the reader has to trust. The detail payload does
                  // not carry a per-directive group id, so fall back to the bar's group total.
                  const groupRows = focused.directives.filter(
                    (d) => (d.group ?? d.groupId ?? d.kind) === id,
                  );
                  return (
                    <span key={id} className="mvp-group-pill">
                      {id}
                      <em>{Number(pct).toFixed(0)}%</em>
                      <WhyPopover title={`What “${id}” means on this bar`} hover>
                        A directive group — related rules scored together and capped before they
                        contribute to the composite. Here it is <strong>{Number(pct).toFixed(0)}%</strong> of
                        this bar’s total.
                        {groupRows.length > 0 && (
                          <>
                            {' '}It holds {groupRows.length} directive
                            {groupRows.length === 1 ? '' : 's'} on this bar.
                          </>
                        )}
                        {' '}A group’s share can be tuned by weight strategy, so the same group is not
                        always worth the same.
                      </WhyPopover>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="mvp-scroll mvp-depth-scroll">
              <table className="mvp-table">
                <thead>
                  <tr>
                    <th scope="col">Directive</th>
                    <th scope="col" className="mvp-num">Score</th>
                    <th scope="col" className="mvp-num">Max</th>
                    <th scope="col">Share</th>
                    <th scope="col">Class</th>
                    <th scope="col">Counted</th>
                  </tr>
                </thead>
                <tbody>
                  {[...focused.directives]
                    .sort((a, b) => Number(b.score) - Number(a.score))
                    .map((d) => (
                      <tr key={d.directiveId}>
                        <td className="mvp-nowrap">
                          <span className="mvp-directive-name">
                            {d.directiveId}
                            {/* ⚠️ The reason is a SENTENCE about one bar — help, not content. It used to
                                be a second line under every directive, which turned a six-row table into a
                                wall of text (measured by the reader 2026-11-20). */}
                            {d.reason && (
                              <WhyPopover title={`Why ${d.directiveId} scored this`}>{d.reason}</WhyPopover>
                            )}
                          </span>
                        </td>
                        <td className="mvp-num">{Number(d.score).toFixed(1)}</td>
                        <td className="mvp-num">{Number(d.maxScore).toFixed(1)}</td>
                        <td>
                          <span className="mvp-share" title={`${Math.round((Number(d.score) / Math.max(1, Number(d.maxScore))) * 100)}% of its ceiling`}>
                            <span
                              className="mvp-share-fill"
                              style={{ width: `${Math.round((Number(d.score) / Math.max(1, Number(d.maxScore))) * 100)}%` }}
                            />
                          </span>
                        </td>
                        <td className="mvp-nowrap mvp-muted">{d.signalClass}</td>
                        <td className="mvp-nowrap">
                          {d.inSignal == null ? (
                            <span className="mvp-muted">—</span>
                          ) : d.inSignal ? (
                            <span className="mvp-state mvp-state--entry">in signal</span>
                          ) : (
                            <span className="mvp-state">not counted</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="mvp-note">
          A directive that reads neutral contributes 0 and cannot lift the composite, however far the
          price has run. That is the mechanism to inspect first when a large move produces a small score.
        </p>
      </section>
    </div>
  );
}
