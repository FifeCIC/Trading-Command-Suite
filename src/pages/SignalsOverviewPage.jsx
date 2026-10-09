/**
 * Signals Overview — the /signals/ area (#684 Signals v1).
 * ==========================================================
 * The best-of opportunities ladder: every ACTIVE protocol is scored and
 * the strongest actionable setups surface here — no symbol selection, no
 * protocol selection. Action-only (no HOLD), ranked by combined strength
 * (0.5 × signal + 0.5 × opportunity).
 *
 * Contrast with /scoring/ (SEES monitoring: every ladder, all scores —
 * including the poor ones).
 *
 * Data:
 *   GET /api/signals/best        — ranked actionable envelopes
 *   GET /api/signals/dismissals  — active dismissals (show-dismissed)
 *   POST /api/signals/dismiss    — hide a signal for N hours
 *   GET /api/signals/:id/action  — bot-action state per signal
 *   POST /api/signals/:id/trade  — manual trade via the bot's safety chain
 */
import { useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageInfoPopover from '../components/PageInfoPopover';
import LoadingSkeleton from '../components/LoadingSkeleton';
import NoticeBlock from '../components/NoticeBlock';
// ⚠️ `buildScoreDisplay` and `describeThresholdScale` were REMOVED here 2026-10-09 (#1098 item
// 2.2): they were consumed only by the deleted legacy card. `thresholdGeometry` STAYS — the page
// body still uses it, which is why the old warning about these imports was only half right.
import { thresholdGeometry } from '../core/score-display';
import { timeAgo } from '../core/format-utils';
import { stripWarningGlyph } from '../core/signal-utils';
// #826 Phase 2 — every user-facing message on this page comes from the notice registry. Call sites
// pass a CODE plus data; the wording lives in src/core/notices/registry.js. This is what lets a user
// quote a code we can grep, and what stops each card inventing its own phrasing for the same event.
import { notice } from '../core/notices/registry';
import {
  fetchBestSignals,
  fetchSignalDismissals,
  fetchSignalAnalytics,
  fetchTradeDefaults,
} from '../core/api/signals';
import SignalCard from '../components/SignalCard';
// Shared with the META.Stack Cockpit's Signals column. `directionLabel` and
// `topDirectives` are consumed by BOTH card variants, so they live in the shared
// module rather than being duplicated here — a copy would let A and B disagree
// about the same envelope. `REFRESH_MS` is aliased so the page's own cadence and
// the per-card cadence cannot drift apart.
import { SIGNAL_REFRESH_MS as REFRESH_MS, directionLabel, topDirectives, readDismissHours } from '../core/signal-card-view';
import './signals-overview.css';


/**
 * `roundPct` and `buildNotices` MOVED to src/core/signal-card-view.js (2026-09-17),
 * where the shared `SignalCard` consumes them. `buildNotices` is the one that
 * matters: it is what makes a blocker, a warning and a conflict render through ONE
 * uniform list, and the notice CODE is what a user quotes in a bug report — so the
 * same condition must produce the same code on every page that shows a signal card.
 */

/**
 * Both card variants have now LEFT this file. Card B (the default) MOVED to
 * src/components/SignalCard.jsx (2026-09-17), so the META.Stack Cockpit's Signals column
 * mounts the same component. Card A — the legacy variant that lived here — was deleted
 * 2026-10-09 (#1098 item 2.2) once `?variant=A` stopped being honoured, so this page now
 * renders ONE card and there is no second implementation to drift from it.
 *
 * ⚠️ The note that used to sit here warned that `stripWarningGlyph` and `thresholdGeometry`
 * were "still imported for card A" — that is why they were kept. With A gone, check whether
 * anything still uses them before treating the imports as needed.
 */

/**
 * Signal Loop panel (#693) — non-executive feedback-loop observability.
 * Dismissal analytics, real-trade outcomes, and rank validation. Read-only:
 * nothing on this panel changes trading behaviour.
 */
function SignalLoopPanel({ data, loading, error }) {
  if (loading && !data) {
    return (
      <section className="sig-loop">
        <details>
          <summary>↺ Signal feedback loop</summary>
          <p className="sig-empty-sub">Loading…</p>
        </details>
      </section>
    );
  }
  if (error && !data) {
    return (
      <section className="sig-loop">
        <details>
          <summary>↺ Signal feedback loop</summary>
          <p className="sig-empty-sub">Analytics unavailable.</p>
        </details>
      </section>
    );
  }
  if (!data) return null;

  const { dismissals, outcomes, ranks } = data;
  const winRate = outcomes.winRate;

  return (
    <section className="sig-loop">
      <details>
        <summary>
          ↺ Signal feedback loop <span className="sig-loop-sub">observability — nothing here changes trading</span>
        </summary>
        <div className="sig-loop-body">
          <div className="sig-loop-stats">
            <div className="sig-loop-stat">
              <strong>{dismissals.total}</strong>
              <em>Dismissals ({dismissals.active} active)</em>
            </div>
            <div className="sig-loop-stat">
              <strong>{outcomes.traded}</strong>
              <em>Signal trades ({outcomes.open} open)</em>
            </div>
            <div className="sig-loop-stat">
              <strong>{winRate != null ? `${winRate}%` : '—'}</strong>
              <em>Closed win rate ({outcomes.won}W / {outcomes.lost}L)</em>
            </div>
            <div className="sig-loop-stat">
              <strong>{ranks.avgRankTraded ?? '—'}</strong>
              <em>Avg rank traded{ranks.avgRankAll != null ? ` vs all ${ranks.avgRankAll}` : ''}</em>
            </div>
          </div>

          <div className="sig-loop-cols">
            <div className="sig-loop-col">
              <h3>Top dismissed protocols</h3>
              {dismissals.byProtocol.length === 0 && <p className="sig-empty-sub">No dismissals recorded yet.</p>}
              <table className="sig-loop-table">
                <tbody>
                  {dismissals.byProtocol.map((r) => (
                    <tr key={r.protocolId}>
                      <td title={r.protocolId}>{r.protocolId}</td>
                      <td className="sig-loop-num">{r.count}</td>
                      <td className="sig-loop-num dim">{r.avgStrength != null ? `avg ${r.avgStrength}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dismissals.bands.length > 0 && (
                <div className="sig-loop-bands">
                  {dismissals.bands.map((b) => (
                    <span key={b.band} className="sig-loop-chip" title="Dismissals by combined strength at dismissal time">
                      {b.band}: {b.count}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="sig-loop-col">
              <h3>Signal trades by protocol</h3>
              {outcomes.byProtocol.length === 0 && <p className="sig-empty-sub">No signal trades recorded yet.</p>}
              <table className="sig-loop-table">
                <tbody>
                  {outcomes.byProtocol.map((r) => (
                    <tr key={r.protocolId}>
                      <td title={r.protocolId}>{r.protocolId}</td>
                      <td className="sig-loop-num">{r.count}</td>
                      <td className="sig-loop-num dim">{r.closed > 0 ? `${r.won}/${r.closed} won` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="sig-loop-note">
                {ranks.snapshots > 0
                  ? `${ranks.snapshots} rank snapshots collected (hourly). Traded cards' avg rank vs all cards validates the 0.5/0.5 combined-strength weighting.`
                  : 'Rank snapshots are collected hourly — first validation data appears after an hour.'}
              </p>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}

export default function SignalsOverviewPage() {
  const queryClient = useQueryClient();
  const [showDismissed, setShowDismissed] = useState(false);
  const dismissHours = readDismissHours();

  // Old|New design variant (#card). New (no ?variant) is the redesigned card; Old is the legacy one
  // card reachable via ?variant=A for side-by-side comparison.
  const [searchParams] = useSearchParams();
  // (the `?variant` read that lived here was removed with the variant itself — see the decision note
  // further down, where the card is chosen)
  // Card B is the SHARED component (src/components/SignalCard.jsx), also mounted by
  // the META.Stack Cockpit. Card A stays here, reachable at `?variant=A` — removing a
  // live variant is a decision, not a refactor.
  // ⚠️ THE LEGACY VARIANT IS NO LONGER HONOURED (2026-10-08). The owner's standing rule is *"if there
  // is ever an A/B test involved when copying, go with B, it will usually be the approach I'm happier
  // with"* — and `?variant=A` was the ONLY way to reach card A, so card B is now the only card. This is
  // the same call that deleted the Protocols Registry's old design, where the two variants had started
  // to drift and only one of them would have received the next fix.
  //
  // ⚠️ `OpportunityCard` IS NOW UNREFERENCED BUT STILL IN THIS FILE (~390 lines, above). It should be
  // deleted in its own pass: doing it here means reproducing the whole page, and a half-removed block
  // of that size is how a page ends up broken. Tracked as #1098 Phase 2.2.
  const Card = SignalCard;

  const bestQuery = useQuery({
    queryKey: ['signals-best'],
    queryFn: fetchBestSignals,
    refetchInterval: REFRESH_MS,
  });

  const dismissalsQuery = useQuery({
    queryKey: ['signals-dismissals'],
    queryFn: fetchSignalDismissals,
    refetchInterval: REFRESH_MS,
    enabled: showDismissed,
  });

  // Manual-trade defaults (#720) — shown in each card's confirm state.
  const tradeDefaultsQuery = useQuery({
    queryKey: ['manual-trade-defaults'],
    queryFn: fetchTradeDefaults,
    staleTime: 60_000,
  });

  // Feedback-loop observability (#693) — non-executive analytics.
  const analyticsQuery = useQuery({
    queryKey: ['signals-analytics'],
    queryFn: fetchSignalAnalytics,
    refetchInterval: 5 * REFRESH_MS,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['signals-best'] });
    queryClient.invalidateQueries({ queryKey: ['signal-action'] });
  };

  const data = bestQuery.data;
  const envelopes = Array.isArray(data?.envelopes) ? data.envelopes : [];

  // ── Filters and an ordering OVERRIDE (owner request, 2026-10-08) ──
  // Owner: *"Lets consider more filters and ordering that overrides the default ordering"*.
  //
  // ⚠️ THE DEFAULT IS THE SERVER'S ORDER, and it is not arbitrary: `/api/signals/best` returns
  // envelopes sorted by `combinedStrength` desc (signal-envelope.service.ts:1554), which is
  // 0.5×signalPct + 0.5×opportunityPct. So every other option here is an explicit OVERRIDE of a
  // meaningful ranking, and the default button says so rather than reading as "unsorted".
  //
  // ⚠️ WHAT IS *NOT* HERE — "prioritise symbols with highest past profit" (same note). No per-symbol
  // P&L reaches this page: `getAnalytics()` aggregates the `trade` table by PROTOCOL, not by symbol,
  // and `SignalEnvelope` carries no profit field. Inventing a client-side proxy for it would put a
  // number on screen that nothing measured. It needs a server aggregate — see the walkthrough note.
  const [dirFilter, setDirFilter] = useState('all');
  const [protoFilter, setProtoFilter] = useState('all');
  const [listOrder, setListOrder] = useState('strength');

  // ── Past profit per symbol (owner request: "ability to priortise symbols with highest past profit") ──
  // ⚠️ THE FIGURE ALREADY EXISTED — this reads it rather than computing a second one.
  //
  // ── DECISION (2026-10-09, primary) ──
  // WHAT:      Per-symbol realised P&L is read from `PnlReport.bySymbol` (GET /api/scoring/edge/pnl),
  //            NOT from /api/journal/stats.
  // WHY:       This code first read /api/journal/stats on the note that `journal.service` "already
  //            builds bySymbol". It builds the SHAPE — over an EMPTY in-memory array. Measured
  //            2026-10-09: `totalTrades: 0` and `bySymbol: []` against **440 closed `trade` rows**,
  //            with `winRate` shipped as the literal string "NaN%" (0/0). So `hasProfitData` was
  //            false for the WRONG REASON: the control said "no data" while the data existed.
  //            ⚠️ An empty AGGREGATE is not evidence that the SOURCE is empty — the source must be
  //            read before absence is reported (the same shape as #758's observed-vs-configured
  //            denominator: plausible output, no error, wrong underneath).
  //            `PnlReport` is the canonical computation — quarantine-aware (excludes `pnlInvalid`
  //            rows, the #805 fabrication) with `reliability` bands — and answers with real rows:
  //            measured 2026-10-09, XAUUSD 54 trades, winRate 0.3519, totalPnl −1047.8657.
  // INSTEAD OF: wiring `JournalService` to Prisma, which would re-derive realised P&L and duplicate
  //            the `pnlInvalid` exclusion and the reliability bands. Two copies drift and only one
  //            receives the next fix.
  // REVERSE BY: Deleting this marker and restoring the `/api/journal/stats` read with
  //            `queryKey: ['sig-journal-stats']` below.
  // REGISTER:  docs/SETTLED-DECISIONS.md row 76
  //            ⚠️ Renumbered from 75 — another agent claimed 75 on this shared tree mid-edit. If you
  //            renumber this again, update THIS line; a marker pointing at the wrong register row is
  //            a broken pointer, which is the #919 failure (homes 1 and 3 present, home 2 unfindable).
  // GUARD:     none — see the register row's status.
  const statsQuery = useQuery({
    queryKey: ['sig-pnl-stats'],
    queryFn: () => apiGet('/api/scoring/edge/pnl').catch(() => null),
    staleTime: 60_000,
  });
  const pnlBySymbol = useMemo(() => {
    const rows = statsQuery.data?.bySymbol;
    const m = new Map();
    if (Array.isArray(rows)) {
      rows.forEach((r) => {
        // ⚠️ `label`, not `symbol` — `PnlBucket` names this field `label`. Reading `r.symbol` here
        // would build an EMPTY map while looking correct, since the keys are the entire payload.
        const key = r?.label ?? r?.symbol;
        if (key) m.set(String(key).toUpperCase(), Number(r.totalPnl ?? 0));
      });
    }
    return m;
  }, [statsQuery.data]);
  // ⚠️ The control still renders DISABLED when the map is empty — but the reason is now correct:
  // genuinely absent data, not a broken read. A filter that quietly does nothing is the failure this
  // repo keeps re-finding (the reader cannot tell it from working code), so it says so rather than
  // sorting every symbol onto `-Infinity`.
  //
  // ⚠️ NOT SURFACED (buried ability, recorded not fixed): each bucket carries a `reliability` band
  // (`noise` below n=20). The ordering does not use it, so a 3-trade symbol can outrank a 54-trade
  // one. That is a change to what the ordering MEANS, not a bug fix — it needs its own decision.
  const hasProfitData = pnlBySymbol.size > 0;

  const protocolOptions = useMemo(() => {
    const m = new Map();
    envelopes.forEach((e) => { if (e.protocolId) m.set(e.protocolId, e.protocolName || e.protocolId); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [envelopes]);

  const visibleEnvelopes = useMemo(() => {
    const isBuy = (e) => e.signal === 'BUY' || e.signal === 'STRONG_BUY';
    const isSell = (e) => e.signal === 'SELL' || e.signal === 'STRONG_SELL';
    const filtered = envelopes.filter((e) =>
      (dirFilter === 'all' || (dirFilter === 'buy' ? isBuy(e) : isSell(e))) &&
      (protoFilter === 'all' || e.protocolId === protoFilter),
    );
    // A null `signalPct`/`opportunityPct` sorts LAST, not first: `-1` keeps a missing measurement
    // below every real one instead of letting `null` coerce to 0 and outrank a genuine 0.
    const cmp = {
      strength: (a, b) => b.combinedStrength - a.combinedStrength,
      signal: (a, b) => (b.signalPct ?? -1) - (a.signalPct ?? -1),
      opportunity: (a, b) => (b.opportunityPct ?? -1) - (a.opportunityPct ?? -1),
      confidence: (a, b) => (b.confidence ?? -1) - (a.confidence ?? -1),
      symbol: (a, b) => a.symbol.localeCompare(b.symbol),
      // ⚠️ `-Infinity`, NOT 0, for a symbol with no recorded history. Using 0 would place an
      // UNMEASURED symbol level with one that genuinely broke even, and above every symbol that lost
      // money — the ordering would look confident while resting on absent data.
      profit: (a, b) =>
        (pnlBySymbol.get(String(b.symbol).toUpperCase()) ?? -Infinity) -
        (pnlBySymbol.get(String(a.symbol).toUpperCase()) ?? -Infinity),
    }[listOrder];
    return [...filtered].sort(cmp);
  }, [envelopes, dirFilter, protoFilter, listOrder, pnlBySymbol]);

  return (
    <div className="sig-page">
      <motion.header className="sig-header" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1>
          Signals
          <PageInfoPopover>
            The best of opportunities, surfaced for action. Every active protocol is scored and only actionable
            BUY/SELL setups appear — ranked by combined strength (signal + opportunity). Contrast with Scoring
            (SEES monitoring — every ladder and all scores). Trades go through the same safety chain as the bot.
          </PageInfoPopover>
        </h1>
        {data && (
          <span className="sig-sub">
            {data.totalSymbols} opportunit{data.totalSymbols === 1 ? 'y' : 'ies'} · {data.buyCount} buy · {data.sellCount} sell ·{' '}
            {data.activeProtocols} active protocols · updated {timeAgo(data.generatedAt)}
          </span>
        )}
      </motion.header>

      <div className="sig-toolbar">
        <button type="button" className="sig-tool" onClick={refresh} disabled={bestQuery.isFetching}>
          {bestQuery.isFetching ? 'Refreshing…' : '↻ Refresh'}
        </button>
        <button
          type="button"
          className={`sig-tool ${showDismissed ? 'sig-tool--active' : ''}`}
          onClick={() => setShowDismissed((s) => !s)}
        >
          Show dismissed
        </button>

        {/* Direction filter — the signal class is the envelope's own field, so this is a real
            filter, not a text match on a label. */}
        {[['all', 'All'], ['buy', 'Buys'], ['sell', 'Sells']].map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`sig-tool ${dirFilter === v ? 'sig-tool--active' : ''}`}
            aria-pressed={dirFilter === v}
            onClick={() => setDirFilter(v)}
          >
            {label}
          </button>
        ))}

        {protocolOptions.length > 1 && (
          <select
            className="sig-tool"
            aria-label="Filter by protocol"
            value={protoFilter}
            onChange={(e) => setProtoFilter(e.target.value)}
          >
            <option value="all">All protocols</option>
            {protocolOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}

        <span className="sig-sub">Order</span>
        {[
          ['strength', 'Best of (default)', 'The server\u2019s own ranking — 50% signal + 50% opportunity'],
          ['signal', 'Signal %', 'Highest pre-gate directional strength first'],
          ['opportunity', 'Opportunity %', 'Highest additive screening score first'],
          ['confidence', 'Confidence', 'Highest confidence score first'],
          ['profit', 'Past profit', 'Highest realised P&L for that symbol, taken from the trade journal'],
          ['symbol', 'Symbol A–Z', 'Alphabetical, to find a known ticker'],
        ].map(([v, label, title]) => {
          const unavailable = v === 'profit' && !hasProfitData;
          return (
            <button
              key={v}
              type="button"
              className={`sig-tool ${listOrder === v ? 'sig-tool--active' : ''}`}
              aria-pressed={listOrder === v}
              disabled={unavailable}
              title={
                unavailable
                  ? 'No per-symbol P&L yet — the trade journal has no closed trades to summarise, so this would sort every symbol equally.'
                  : title
              }
              onClick={() => setListOrder(v)}
            >
              {label}{unavailable ? ' · no data' : ''}
            </button>
          );
        })}

        {(dirFilter !== 'all' || protoFilter !== 'all') && (
          <span className="sig-sub">
            Showing {visibleEnvelopes.length} of {envelopes.length}
          </span>
        )}
      </div>

      {bestQuery.isLoading && <LoadingSkeleton rows={4} />}

      {bestQuery.isError && (
        <div className="sig-banner">
          {/* Page-level failure as a registry notice, so it carries a code the user can quote. */}
          <NoticeBlock
            notice={notice('TCS-SIG-001', {
              detail: bestQuery.error?.detail
                || bestQuery.error?.message
                || 'The API returned no usable response.',
            })}
          />
          <button type="button" className="sig-link-btn" onClick={refresh}>Retry</button>
        </div>
      )}

      {data && envelopes.length === 0 && (
        <div className="sig-empty">
          <p>No actionable signals right now.</p>
          <p className="sig-empty-sub">
            HOLD scores (no directional edge) are intentionally hidden here — see the Scoring area for the full picture.
          </p>
        </div>
      )}

      {data && envelopes.length > 0 && visibleEnvelopes.length === 0 && (
        <div className="sig-empty">
          <p>No signals match the current filter.</p>
          <p className="sig-empty-sub">
            {envelopes.length} opportunit{envelopes.length === 1 ? 'y' : 'ies'} are loaded — clear the
            direction or protocol filter to see them.
          </p>
        </div>
      )}

      <div className="sig-opp-grid">
        <AnimatePresence>
          {visibleEnvelopes.map((env) => (
            <Card
              key={`${env.symbol}|${env.protocolId}|${env.directionMode}`}
              envelope={env}
              dismissHours={dismissHours}
              onDismissed={refresh}
              defaults={tradeDefaultsQuery.data}
            />
          ))}
        </AnimatePresence>
      </div>

      {showDismissed && (
        <section className="sig-dismissed">
          <h2>Dismissed signals</h2>
          {dismissalsQuery.isLoading && <p className="sig-empty-sub">Loading…</p>}
          {dismissalsQuery.data && dismissalsQuery.data.length === 0 && (
            <p className="sig-empty-sub">Nothing dismissed — cards reappear automatically when the horizon passes.</p>
          )}
          {(dismissalsQuery.data || []).map((d) => (
            <span key={`${d.symbol}|${d.protocolId}`} className="sig-dismissed-item">
              {d.symbol} · {d.protocolId} — returns {timeAgo(d.dismissedUntil)}
            </span>
          ))}
        </section>
      )}

      <SignalLoopPanel
        data={analyticsQuery.data}
        loading={analyticsQuery.isLoading}
        error={analyticsQuery.isError}
      />

      <div className="sig-links">
        <Link to="/scoring/symbols-ladder" className="sig-link">View the full Symbols Ladder (Scoring)</Link>
        <Link to="/scoring/live-ordering-stack" className="sig-link">View the Scoring Ladder</Link>
      </div>
    </div>
  );
}

