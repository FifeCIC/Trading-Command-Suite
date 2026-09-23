/**
 * StrategyComparisonPage — /trading/strategy-comparison
 * =====================================================
 * A HORIZONTAL comparison matrix: one COLUMN per strategy, one ROW per comparison criterion.
 *
 * WHY COLUMNS AND NOT ROWS (project owner's spec, 2026-09-23 — quoted verbatim):
 *   "It's a visual for the user to see what is different between selected strategies ... This
 *    needs to be a clever horizontal view with toggles to order by selected criteria. My first
 *    objective will be P/L and expect when I scroll to the end to see the losing strategy."
 *
 * So the strategies are SORTED by the chosen criterion and laid out left→right: the best is the
 * leftmost column and scrolling right walks DOWN the ranking, ending on the worst. The metric
 * label column (`th` in `tbody`) and the strategy header row (`thead`) are both sticky, so you do
 * not lose your place while reading across. Default sort is total P&L.
 *
 * WHAT IS COMPARED — the whole strategy, not just its P&L: outcomes, P&L by day, the protocol it
 * subscribes to, its directives (with each one's maxScore), its 10 most recent trades and its 10
 * most recent scores.
 *
 * ⚠️⚠️ IDENTITY IS MEASURED, NOT ASSUMED — read before touching the backend join.
 * `trade.strategy` is a **BOT NAME**, not a protocol id (21 of 32 live names match a bot; 4 match
 * a protocol name, and those 4 are the XAU bots whose names coincide). The bot→protocol link is
 * `strategy_protocol.protocolId`, which holds a **SLUG**, not a uuid. Verified against live data
 * 2026-09-23: joining on `protocol.slug` leaves 0 of 27 unmatched.
 *
 * Three states are therefore REAL and are reported rather than rendered as blank cells:
 *   kind 'bot'       — matched a bot, has a protocol subscription. Fully comparable.
 *   kind 'name_only' — a name with no bot row. No protocol can be shown. (11 of 32 live names.)
 *   bot, no protocol — `excluded.noSubscription`. This bot CANNOT TRADE. Serious, so it is called
 *                      out in the column header, not buried. See database-seed-discipline.
 * A blank protocol cell would read as "there is none"; these read as what they are.
 *
 * ⚠️ Colour-blind mode (src/index.css) injects a ▲/▼ pseudo-element on any class containing
 * up/down/buy/sell/win/lose. The direction classes here are `--pos` / `--neg` deliberately. Do
 * not rename them.
 */
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import NoticeBlock from '../components/NoticeBlock';
import PageInfoPopover from '../components/PageInfoPopover';
import { notice } from '../core/notices/registry.js';
import { noticeFromError } from '../core/notices/from-error.js';
import './strategy-comparison.css';

/**
 * The order-by toggles. Each entry reads one field so a new criterion is a one-line addition.
 * `nullish` decides what a missing value sorts as — always LAST, never as a zero, because a
 * strategy with no profit factor (no losing trades yet) has not earned 0.0.
 */
const SORTERS = [
  { id: 'totalPnl', label: 'P&L', get: (s) => s.totalPnl },
  { id: 'trades', label: 'Trades', get: (s) => s.trades },
  { id: 'winRate', label: 'Win rate', get: (s) => s.winRate },
  { id: 'profitFactor', label: 'Profit factor', get: (s) => (s.profitFactor ?? null), nullish: -Infinity },
  { id: 'avgWinPnl', label: 'Avg win', get: (s) => s.avgWinPnl },
  { id: 'maxDrawdown', label: 'Drawdown', get: (s) => s.maxDrawdown },
  { id: 'directiveMaxTotal', label: 'Weight', get: (s) => (s.directiveMaxTotal ?? null), nullish: -Infinity },
];

const fmtMoney = (v) =>
  v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}`;

/** P&L value with an explicit sign AND a word, so colour is never the only carrier of meaning. */
function Pnl({ value }) {
  if (value === null || value === undefined) return <span className="strategycmp-muted">—</span>;
  return (
    <span className={`strategycmp-pnl ${value >= 0 ? 'strategycmp-pos' : 'strategycmp-neg'}`}>
      {fmtMoney(value)}
    </span>
  );
}

/** 14 daily P&L bars, drawn from zero. Scale is per-column so each strategy reads on its own range. */
function DailyBars({ values, days }) {
  const peak = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
  return (
    <div className="strategycmp-bars" role="img"
      aria-label={`Daily P&L over ${values.length} days, from ${days[0]} to ${days[days.length - 1]}`}>
      {values.map((v, i) => (
        <span
          key={days[i]}
          className={`strategycmp-bar ${v >= 0 ? 'strategycmp-pos' : 'strategycmp-neg'}`}
          style={{ height: `${Math.max(6, (Math.abs(v) / peak) * 100)}%` }}
          title={`${days[i]}: ${fmtMoney(v)}`}
        />
      ))}
    </div>
  );
}

export default function StrategyComparisonPage() {
  const [sortId, setSortId] = useState('totalPnl');
  const [ascending, setAscending] = useState(false);

  const query = useQuery({
    queryKey: ['strategy-comparison'],
    queryFn: () => apiGet('/api/trading/strategy-comparison'),
    refetchInterval: 30000,
  });

  /**
   * ⚠️ NOT `query.isError` — see #964. TanStack pauses a never-succeeded query when it believes
   * the browser is offline, and a paused query reports `isError: false` forever. `main.jsx` now
   * sets `networkMode: 'always'` so that specific trap is closed app-wide, but this predicate is
   * still the honest one: it is true whenever we have no data and are not loading, whatever the
   * reason (error, pause, abort).
   */
  const unavailable = query.data === undefined && !query.isLoading;

  const strategies = useMemo(() => {
    const rows = Array.isArray(query.data?.showdown) ? [...query.data.showdown] : [];
    const sorter = SORTERS.find((s) => s.id === sortId) ?? SORTERS[0];
    rows.sort((a, b) => {
      const av = sorter.get(a) ?? sorter.nullish ?? -Infinity;
      const bv = sorter.get(b) ?? sorter.nullish ?? -Infinity;
      return ascending ? av - bv : bv - av;
    });
    return rows;
  }, [query.data, sortId, ascending]);

  const days = Array.isArray(query.data?.pnlDays) ? query.data.pnlDays : [];
  const excluded = query.data?.excluded;
  const livePositions = Array.isArray(query.data?.livePositions) ? query.data.livePositions : [];

  if (query.isLoading) return <div className="strategycmp-page"><LoadingSkeleton variant="card" count={4} /></div>;

  return (
    <div className="strategycmp-page">
      <motion.header className="strategycmp-header" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>
            Trading Strategy Comparison
            <PageInfoPopover>
              Every strategy as a column, every criterion as a row, sorted best-first — so the
              worst performer is the last one you scroll to. Compare outcomes, daily P&amp;L,
              protocol, directives, and the most recent trades and scores. Profit is the truth;
              nothing here is estimated.
            </PageInfoPopover>
          </h1>
          <p className="strategycmp-subtitle">
            {unavailable
              ? 'Comparison could not be read — see below'
              : `${strategies.length} strateg${strategies.length === 1 ? 'y' : 'ies'} with priced, tagged closes`}
            {query.data?.generatedAt ? ` · ${new Date(query.data.generatedAt).toLocaleTimeString()}` : ''}
          </p>
        </div>
      </motion.header>

      {unavailable && (
        <div className="strategycmp-banner" role="alert">
          <NoticeBlock
            notice={
              query.error
                ? noticeFromError(query.error, 'TCS-SYS-009', {
                    detail: 'the strategy comparison request did not complete',
                  })
                : notice('TCS-SYS-009', {
                    detail: 'the request was paused — the app believes it is offline',
                  })
            }
          />
        </div>
      )}

      {!unavailable && excluded && (excluded.unpriced > 0 || excluded.noStrategy > 0) && (
        <p className="strategycmp-note">
          Excluded from every figure here: {excluded.unpriced} of {excluded.totalClosed} closed
          rows have no priced exit (never realised at a broker — not $0 trades, they cannot be
          scored) and {excluded.noStrategy} carry no strategy tag.
        </p>
      )}

      {excluded?.noSubscription?.length > 0 && (
        <p className="strategycmp-note strategycmp-note--warn">
          ⚠️ {excluded.noSubscription.length} linked bot
          {excluded.noSubscription.length === 1 ? ' has' : 's have'} no protocol subscription
          ({excluded.noSubscription.join(', ')}) — a bot in this state cannot trade, so its row
          can show no protocol or directives.
        </p>
      )}

      {excluded?.unresolvedNames?.length > 0 && (
        <p className="strategycmp-note">
          {excluded.unresolvedNames.length} name
          {excluded.unresolvedNames.length === 1 ? '' : 's'} in the trade log match no configured
          bot, so no protocol can be shown: {excluded.unresolvedNames.join(', ')}.
        </p>
      )}

      {!unavailable && strategies.length > 0 && (
        <div className="strategycmp-controls" role="group" aria-label="Order the strategy columns by">
          <span className="strategycmp-controls-label">Order by</span>
          {SORTERS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`strategycmp-toggle ${sortId === s.id ? 'strategycmp-toggle--on' : ''}`}
              aria-pressed={sortId === s.id}
              onClick={() => {
                if (sortId === s.id) setAscending((v) => !v);
                else {
                  setSortId(s.id);
                  // Drawdown and Trades read more naturally worst-first; everything else best-first.
                  setAscending(s.id === 'maxDrawdown');
                }
              }}
            >
              {s.label}
              {sortId === s.id && (
                <span aria-hidden="true" className="strategycmp-toggle-dir">
                  {ascending ? '▲' : '▼'}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {strategies.length === 0 && !unavailable ? (
        <div className="strategycmp-empty">
          <p>
            No priced, strategy-tagged closed trades yet — this page will not guess.
            {excluded
              ? ` Of ${excluded.totalClosed} closed rows, ${excluded.unpriced} have no priced exit and ${excluded.noStrategy} carry no strategy tag.`
              : ''}
          </p>
        </div>
      ) : null}

      {strategies.length > 0 && (
        <div className="strategycmp-scroll">
          <table className="strategycmp-table">
            <caption className="strategycmp-visually-hidden">
              Strategy comparison. One column per strategy, ordered by {SORTERS.find((s) => s.id === sortId)?.label}.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="strategycmp-corner">Criterion</th>
                {strategies.map((s, i) => (
                  <th key={s.strategy} scope="col" className="strategycmp-colhead">
                    <span className="strategycmp-rank">#{i + 1}</span>
                    <span className="strategycmp-name" title={s.strategy}>{s.strategy}</span>
                    <span className="strategycmp-meta">
                      {s.identity.symbol ? `${s.identity.symbol} · ${s.identity.mode}` : 'no bot row'}
                    </span>
                    <Pnl value={s.totalPnl} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="strategycmp-band"><th scope="row" colSpan={strategies.length + 1}>Outcomes</th></tr>
              <tr>
                <th scope="row">Trades</th>
                {strategies.map((s) => (
                  <td key={s.strategy}>{s.trades}{s.breakEven > 0 ? ` (${s.breakEven} B/E)` : ''}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Win rate</th>
                {strategies.map((s) => (
                  <td key={s.strategy}>{s.winRate}% <span className="strategycmp-muted">({s.wins}W/{s.losses}L)</span></td>
                ))}
              </tr>
              <tr>
                <th scope="row">Avg win</th>
                {strategies.map((s) => (<td key={s.strategy} className="strategycmp-pos">{fmtMoney(s.avgWinPnl)}</td>))}
              </tr>
              <tr>
                <th scope="row">Avg loss</th>
                {strategies.map((s) => (<td key={s.strategy} className="strategycmp-neg">{fmtMoney(s.avgLossPnl)}</td>))}
              </tr>
              <tr>
                <th scope="row">Best / worst</th>
                {strategies.map((s) => (
                  <td key={s.strategy}>
                    <span className="strategycmp-pos">{fmtMoney(s.bestTrade)}</span>
                    {' / '}
                    <span className="strategycmp-neg">{fmtMoney(s.worstTrade)}</span>
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Profit factor</th>
                {strategies.map((s) => (
                  <td key={s.strategy}>
                    {s.profitFactor != null ? s.profitFactor.toFixed(2) : <span className="strategycmp-muted" title="No losing trades yet — a factor cannot be computed">—</span>}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Max drawdown</th>
                {strategies.map((s) => (<td key={s.strategy}>{s.maxDrawdown}%</td>))}
              </tr>
              <tr>
                <th scope="row">Symbols traded</th>
                {strategies.map((s) => (<td key={s.strategy}>{s.symbolCount}</td>))}
              </tr>

              <tr className="strategycmp-band"><th scope="row" colSpan={strategies.length + 1}>P&amp;L by day — last {days.length} days</th></tr>
              <tr>
                <th scope="row">Daily</th>
                {strategies.map((s) => (
                  <td key={s.strategy}><DailyBars values={s.pnlByDay ?? []} days={days} /></td>
                ))}
              </tr>
              <tr>
                <th scope="row">Running total</th>
                {strategies.map((s) => {
                  const cum = s.pnlCumulative ?? [];
                  return <td key={s.strategy}>{cum.length ? <Pnl value={cum[cum.length - 1]} /> : '—'}</td>;
                })}
              </tr>
              <tr>
                <th scope="row">Best day</th>
                {strategies.map((s) => {
                  const d = s.pnlByDay ?? [];
                  if (!d.length) return <td key={s.strategy}>—</td>;
                  const best = Math.max(...d);
                  const i = d.indexOf(best);
                  return <td key={s.strategy}><span className="strategycmp-pos">{fmtMoney(best)}</span> <span className="strategycmp-muted">{days[i]}</span></td>;
                })}
              </tr>
              <tr>
                <th scope="row">Worst day</th>
                {strategies.map((s) => {
                  const d = s.pnlByDay ?? [];
                  if (!d.length) return <td key={s.strategy}>—</td>;
                  const worst = Math.min(...d);
                  const i = d.indexOf(worst);
                  return <td key={s.strategy}><span className="strategycmp-neg">{fmtMoney(worst)}</span> <span className="strategycmp-muted">{days[i]}</span></td>;
                })}
              </tr>

              <tr className="strategycmp-band"><th scope="row" colSpan={strategies.length + 1}>Protocol</th></tr>
              <tr>
                <th scope="row">Protocol</th>
                {strategies.map((s) => (
                  <td key={s.strategy}>
                    {s.protocol
                      ? <span title={s.protocol.slug}>{s.protocol.name}</span>
                      : s.identity.kind === 'bot'
                        ? <span className="strategycmp-neg">no subscription</span>
                        : <span className="strategycmp-muted">no bot row for this name</span>}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Timeframe</th>
                {strategies.map((s) => (<td key={s.strategy}>{s.protocol?.timeframe ?? <span className="strategycmp-muted">—</span>}</td>))}
              </tr>
              <tr>
                <th scope="row">Style</th>
                {strategies.map((s) => (<td key={s.strategy}>{s.protocol?.tradingStyle ?? <span className="strategycmp-muted">—</span>}</td>))}
              </tr>
              <tr>
                <th scope="row">Direction mode</th>
                {strategies.map((s) => (<td key={s.strategy}>{s.protocol?.directionMode ?? <span className="strategycmp-muted">—</span>}</td>))}
              </tr>
              <tr>
                <th scope="row">Win-rate target</th>
                {strategies.map((s) => (<td key={s.strategy}>{s.protocol?.winRateTarget ?? <span className="strategycmp-muted">—</span>}</td>))}
              </tr>
              <tr>
                <th scope="row">Derived from</th>
                {strategies.map((s) => (<td key={s.strategy}>{s.derivedFrom ?? <span className="strategycmp-muted">—</span>}</td>))}
              </tr>

              <tr className="strategycmp-band"><th scope="row" colSpan={strategies.length + 1}>Directives</th></tr>
              <tr>
                <th scope="row">Active / total weight</th>
                {strategies.map((s) => {
                  const active = (s.directives ?? []).filter((d) => d.active);
                  if (!active.length) return <td key={s.strategy} className="strategycmp-muted">—</td>;
                  return (
                    <td key={s.strategy}>
                      {active.length} <span className="strategycmp-muted">· max {s.directiveMaxTotal ?? 0}</span>
                    </td>
                  );
                })}
              </tr>
              <tr>
                <th scope="row">Which</th>
                {strategies.map((s) => {
                  const active = (s.directives ?? []).filter((d) => d.active);
                  if (!active.length) return <td key={s.strategy} className="strategycmp-muted">—</td>;
                  return (
                    <td key={s.strategy}>
                      <ul className="strategycmp-dirlist">
                        {active.map((d) => (
                          <li key={d.directiveId} title={`${d.groupName} · group weight ${d.groupWeight}${d.isRiskGate ? ' · RISK GATE' : ''}`}>
                            <span className="strategycmp-dirname">{d.directiveId}</span>
                            <span className="strategycmp-muted">{d.maxScore}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  );
                })}
              </tr>

              <tr className="strategycmp-band"><th scope="row" colSpan={strategies.length + 1}>Recent trades (most recent first)</th></tr>
              <tr>
                <th scope="row">Last 10</th>
                {strategies.map((s) => {
                  const list = s.recentTrades ?? [];
                  if (!list.length) return <td key={s.strategy} className="strategycmp-muted">no priced closes</td>;
                  return (
                    <td key={s.strategy}>
                      <ul className="strategycmp-list">
                        {list.map((t, i) => (
                          <li key={`${t.symbol}-${t.closedAt}-${i}`}>
                            <span className="strategycmp-listsym">{t.symbol}</span>
                            <span className="strategycmp-muted">{String(t.side ?? '').slice(0, 1).toUpperCase()}</span>
                            <Pnl value={t.pnl} />
                            <span className="strategycmp-muted strategycmp-listtime">
                              {t.closedAt ? new Date(t.closedAt).toLocaleDateString() : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  );
                })}
              </tr>

              <tr className="strategycmp-band"><th scope="row" colSpan={strategies.length + 1}>Recent scores</th></tr>
              <tr>
                <th scope="row">Last 10</th>
                {strategies.map((s) => {
                  const list = s.recentScores ?? [];
                  if (!s.protocol) return <td key={s.strategy} className="strategycmp-muted">no protocol — cannot score</td>;
                  if (!list.length) return <td key={s.strategy} className="strategycmp-muted">no recent scores</td>;
                  return (
                    <td key={s.strategy}>
                      <ul className="strategycmp-list">
                        {list.map((sc, i) => (
                          <li key={`${sc.symbol}-${sc.runAt}-${i}`}>
                            <span className="strategycmp-listsym">{sc.symbol}</span>
                            <span className="strategycmp-muted">{sc.direction}</span>
                            {/* ⚠️ combinedStrength is the 0-100 SCORE; signalPct is a percent of
                                configured capacity (ADR-011). Labelled as such — do not pass
                                signalPct to scoreClass(). */}
                            <span title={`score ${sc.combinedStrength}/100 · ${sc.signalPct ?? '—'}% of capacity`}>
                              {sc.combinedStrength}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <section className="strategycmp-section">
        <h2>Live positions by strategy</h2>
        {query.data?.liveSource && <p className="strategycmp-note">{query.data.liveSource}</p>}
        {livePositions.length === 0 ? (
          <p className="strategycmp-muted">No open positions currently tracked by strategy.</p>
        ) : (
          <div className="strategycmp-live">
            {livePositions.map((lp) => (
              <div key={lp.strategy} className="strategycmp-livecard">
                <div className="strategycmp-livehead">
                  <span className="strategycmp-name">{lp.strategy}</span>
                  <span className="strategycmp-muted">{lp.positionCount} open</span>
                  <Pnl value={lp.totalPnl} />
                </div>
                <ul className="strategycmp-list">
                  {lp.positions.map((p, j) => (
                    <li key={j}>
                      <span className="strategycmp-listsym">{p.symbol}</span>
                      <span className="strategycmp-muted">{String(p.side ?? '').toUpperCase()}</span>
                      <span className="strategycmp-muted">×{p.quantity}</span>
                      <Pnl value={p.pnl ?? 0} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

