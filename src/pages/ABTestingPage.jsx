/**
 * A/B Protocol Testing Page
 * ==========================
 * Side-by-side protocol comparison: run two protocols against the same
 * symbols and compare signal-level output — agreement rate, divergence
 * analysis, directive contribution, direction bias.
 *
 * Data sources:
 *   GET /api/scoring/protocols       — protocol list
 *   POST /api/scoring/gated/batch    — score symbols per protocol
 *   GET /api/watchlists              — symbol selection
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet, apiPost } from '../core/api/client';
import { noticeFromError } from '../core/notices/from-error.js';
import LoadingSkeleton from '../components/LoadingSkeleton';
import Notice from '../components/Notice';
import NoticeBlock from '../components/NoticeBlock';
import ProtocolPicker from '../components/ProtocolPicker';
import './ab-testing.css';
import PageInfoPopover from '../components/PageInfoPopover';

const SIGNAL_COLORS = { BUY: '#22c55e', SELL: '#ef4444', HOLD: '#f59e0b', unknown: '#64748b' };

export default function ABTestingPage() {
  const [protoA, setProtoA] = useState('');
  const [protoB, setProtoB] = useState('');
  const [watchlistId, setWatchlistId] = useState('');
  const [viewMode, setViewMode] = useState('signals'); // 'signals' | 'directives' | 'outcomes'

  // ── Available protocols ──
  // ⚠️ NO `.catch(() => ({ protocols: [] }))` (#953). A failed request must NOT render as an
  // EMPTY LIST: "pick a protocol" with nothing to pick is indistinguishable from a broken API,
  // and the user is invited to keep trying a control that cannot work. React Query captures the
  // error; the render below shows it with its own state.
  const protoQuery = useQuery({
    queryKey: ['ab-protocols'],
    queryFn: () => apiGet('/api/scoring/protocols'),
    staleTime: 120_000,
  });
  // useMemo so the array identity is stable — a fresh `[]` per render would invalidate the
  // comparison memo below on every pass (react-hooks/exhaustive-deps).
  const protocols = useMemo(
    () => (Array.isArray(protoQuery.data?.protocols) ? protoQuery.data.protocols : []),
    [protoQuery.data],
  );

  // ── Available watchlists ──
  const wlQuery = useQuery({
    queryKey: ['ab-watchlists'],
    queryFn: () => apiGet('/api/watchlists'),
    staleTime: 120_000,
  });
  const watchlists = useMemo(() => (Array.isArray(wlQuery.data) ? wlQuery.data : []), [wlQuery.data]);

  // ── Symbols from the selected watchlist ─────────────────────────────────────────────────────
  // ⚠️ THE LIST ENDPOINT DOES NOT CARRY SYMBOLS (#953, measured 2026-09-23): `GET /api/watchlists`
  // returns `symbolCount`, NOT `symbols`. So `selectedWatchlist.symbols` was ALWAYS undefined →
  // `symbols` was always [] → both score queries stayed disabled (`enabled: symbols.length > 0`)
  // and the panel below the selectors was blank for EVERY selection, forever. The fourth silent
  // catch was never even the whole story: the page could not work with the current API shape.
  // The list is a summary; the full watchlist (with symbols) comes from `GET /api/watchlists/:id`.
  const wlDetailQuery = useQuery({
    queryKey: ['ab-watchlist-detail', watchlistId],
    queryFn: () => apiGet(`/api/watchlists/${encodeURIComponent(watchlistId)}`),
    enabled: !!watchlistId,
    staleTime: 120_000,
  });
  const symbols = useMemo(() => {
    const raw = wlDetailQuery.data?.symbols;
    if (!Array.isArray(raw)) return [];
    return raw
      .map(s => (typeof s === 'string' ? s : (s.ticker || '')))
      .filter(Boolean)
      .slice(0, 12);
  }, [wlDetailQuery.data]);

  // ── Score Protocol A ──
  // ⚠️ NO catch (#953): a side that FAILED to score is not a side that AGREED. The old
  // `.catch(() => [])` made a 400/500 from either request render as "no divergence" — a
  // conclusion the data cannot support.
  const scoreAQuery = useQuery({
    queryKey: ['ab-score-a', protoA, watchlistId],
    queryFn: () => apiPost('/api/scoring/gated/batch', {
      tickers: symbols,
      protocolId: protoA,
    }),
    enabled: !!protoA && symbols.length > 0,
    refetchInterval: 30_000,
    // Default retry (3, exponential) left the panel BLANK for ~8s between the first failure and
    // the error state — measured 2026-09-23 (frames at t=2.5…7.5 rendered nothing). One quick
    // retry gets to an honest state in ~2s; the 30s refetchInterval is the real retry loop.
    retry: 1,
    retryDelay: 1200,
  });
  const scoresA = useMemo(() => (Array.isArray(scoreAQuery.data) ? scoreAQuery.data : []), [scoreAQuery.data]);

  // ── Score Protocol B ──
  const scoreBQuery = useQuery({
    queryKey: ['ab-score-b', protoB, watchlistId],
    queryFn: () => apiPost('/api/scoring/gated/batch', {
      tickers: symbols,
      protocolId: protoB,
    }),
    enabled: !!protoB && symbols.length > 0,
    refetchInterval: 30_000,
    retry: 1,
    retryDelay: 1200,
  });
  const scoresB = useMemo(() => (Array.isArray(scoreBQuery.data) ? scoreBQuery.data : []), [scoreBQuery.data]);

  /**
   * State honesty (#953, 2026-09-23) — the three first-class states, kept apart:
   *   loading   → skeleton (below)
   *   error     → "Comparison unavailable" + the HTTP status + a retry, NEVER a divergence figure
   *   empty     → "no comparable rows", which IS information (both sides ran)
   * A failed side and an agreeing side must never render the same thing.
   */
  const bothSidesSelected = !!protoA && !!protoB && !!watchlistId;
  const scoringFailed = scoreAQuery.isError || scoreBQuery.isError;
  const retryScores = () => { scoreAQuery.refetch(); scoreBQuery.refetch(); };

  // ── Build comparison matrix ──
  const comparison = useMemo(() => {
    if (scoresA.length === 0 || scoresB.length === 0) return null;

    const mapA = new Map();
    scoresA.forEach(r => mapA.set(r.symbol, r));
    const mapB = new Map();
    scoresB.forEach(r => mapB.set(r.symbol, r));

    const rows = [];
    let agreeCount = 0;
    let divergeCount = 0;
    const directionBias = { aBullish: 0, bBullish: 0, bothBullish: 0, bothBearish: 0 };

    symbols.forEach(sym => {
      const a = mapA.get(sym);
      const b = mapB.get(sym);
      if (!a || !b) return;

      const aSignal = a.signal || 'HOLD';
      const bSignal = b.signal || 'HOLD';
      const agree = aSignal === bSignal;

      if (agree) agreeCount++; else divergeCount++;

      if (aSignal === 'BUY' && bSignal === 'BUY') directionBias.bothBullish++;
      else if (aSignal === 'SELL' && bSignal === 'SELL') directionBias.bothBearish++;
      else if (aSignal === 'BUY') directionBias.aBullish++;
      else if (bSignal === 'BUY') directionBias.bBullish++;

      rows.push({
        symbol: sym,
        scoreA: a.composite ?? 0,
        scoreB: b.composite ?? 0,
        signalA: aSignal,
        signalB: bSignal,
        agree,
        diff: (a.composite ?? 0) - (b.composite ?? 0),
        rarityA: a.rarity?.band,
        rarityB: b.rarity?.band,
      });
    });

    const total = rows.length;
    const agreeRate = total > 0 ? (agreeCount / total) * 100 : 0;

    return {
      rows: rows.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)),
      total,
      agreeCount,
      divergeCount,
      agreeRate,
      directionBias,
      protoAName: protocols.find(p => p.id === protoA)?.name || protoA,
      protoBName: protocols.find(p => p.id === protoB)?.name || protoB,
    };
  }, [scoresA, scoresB, symbols, protoA, protoB, protocols]);

  // ── Loading ──
  const isLoading = protoQuery.isLoading || wlQuery.isLoading;

  if (isLoading) {
    return (
      <div className="ab-page">
        <header className="ab-header"><h1>A/B Protocol Testing</h1></header>
        <LoadingSkeleton variant="card" count={4} />
      </div>
    );
  }

  return (
    <div className="ab-page">
      <header className="ab-header">
        <div>
          <h1>A/B Protocol Testing
          <PageInfoPopover>
            Compare two protocols side-by-side — signal agreement, divergence analysis, directive contribution
          </PageInfoPopover>
        </h1>
        </div>
      </header>

      {/* ── Selectors ── */}
      <div className="ab-selectors">
        <div className="ab-selector-group">
          <label>Watchlist</label>
          <select value={watchlistId} onChange={e => setWatchlistId(e.target.value)} className="ab-select">
            <option value="">Select watchlist…</option>
            {watchlists.map(w => (
              <option key={w.id} value={w.id}>{w.label || w.name} ({w.symbolCount || '?'})</option>
            ))}
          </select>
        </div>
        <div className="ab-vs">
          <div className="ab-selector-group">
            <label>Protocol A</label>
            <ProtocolPicker
              className="ab-select"
              value={protoA}
              onChange={setProtoA}
              protocols={protocols}
              placeholder="Select protocol…"
            />
          </div>
          <span className="ab-vs-label">vs</span>
          <div className="ab-selector-group">
            <label>Protocol B</label>
            <ProtocolPicker
              className="ab-select"
              value={protoB}
              onChange={setProtoB}
              protocols={protocols}
              placeholder="Select protocol…"
              filterFn={(p) => p.id !== protoA}
            />
          </div>
        </div>
      </div>

      {/* ── Source failures — shown as failures, never as an empty list (#953) ── */}
      {protoQuery.isError && (
        <NoticeBlock
          notice={noticeFromError(protoQuery.error, 'TCS-SYS-002', { operation: 'load the protocol list' })}
          compact
        />
      )}
      {wlQuery.isError && (
        <NoticeBlock
          notice={noticeFromError(wlQuery.error, 'TCS-SYS-002', { operation: 'load the watchlists' })}
          compact
        />
      )}
      {wlDetailQuery.isError && (
        <NoticeBlock
          notice={noticeFromError(wlDetailQuery.error, 'TCS-SYS-002', { operation: "load the watchlist's symbols" })}
          compact
        />
      )}

      {/* A selected watchlist with no symbols explains a compare that cannot run — say so instead
          of leaving the panel blank (the queries are disabled while `symbols` is empty). */}
      {watchlistId && wlDetailQuery.isSuccess && symbols.length === 0 && (
        <Notice level="warning">
          This watchlist has no symbols, so there is nothing to score. Add symbols to it first —
          the comparison needs tickers to run against.
        </Notice>
      )}

      {/* ── No selection ── */}
      {(!protoA || !protoB || !watchlistId) && (
        <Notice level="info">Select a watchlist and two protocols to compare signal output.</Notice>
      )}

      {/* ── Loading ── */}
      {(scoreAQuery.isLoading || scoreBQuery.isLoading || wlDetailQuery.isLoading) && (
        <LoadingSkeleton variant="text" lines={4} className="ls-spacer-top" />
      )}

      {/* ── Scoring failed: COMPARISON UNAVAILABLE, never a divergence figure ──────────────────
          ⚠️ THE REASON THIS PAGE WAS REPORTED (#953). A side that failed has no opinion about
          agreement, so the only honest render is "unavailable" + why + a way to retry. The
          per-side notice below carries the code and the HTTP status. */}
      {bothSidesSelected && scoringFailed && (
        <>
          <Notice level="critical" icon="⛔">
            <strong>Comparison unavailable — a scoring request failed.</strong> A failed run and
            a genuine agreement are different results, so no divergence figure is shown.{' '}
            <button className="ab-retry-btn" onClick={retryScores}>Retry scoring</button>
          </Notice>
          {scoreAQuery.isError && (
            <NoticeBlock
              notice={noticeFromError(scoreAQuery.error, 'TCS-SYS-002', { operation: 'score Protocol A' })}
              compact
            />
          )}
          {scoreBQuery.isError && (
            <NoticeBlock
              notice={noticeFromError(scoreBQuery.error, 'TCS-SYS-002', { operation: 'score Protocol B' })}
              compact
            />
          )}
        </>
      )}

      {/* ── Ran successfully, but nothing comparable — this IS information, unlike a failure ──
          ⚠️ Requires isSuccess on BOTH sides, not merely "not failed": while React Query is
          RETRYING a failing request the query is not yet in its error state, and an "this is not
          an error" line under an actively-failing request is the same lie in a quieter voice. */}
      {bothSidesSelected && scoreAQuery.isSuccess && scoreBQuery.isSuccess && !comparison && (
        <Notice level="info">
          No comparable rows — A returned {scoresA.length} score(s), B returned {scoresB.length}
          {' '}for the selected watchlist's symbols. Nothing to compare yet; this is not an error.
        </Notice>
      )}

      {/* ── Comparison Results ── */}
      {comparison && !scoringFailed && (
        <>
          {/* Summary cards */}
          <div className="ab-summary-grid">
            <div className="ab-summary-card">
              <span className="ab-summary-label">Symbols Compared</span>
              <span className="ab-summary-value">{comparison.total}</span>
            </div>
            <div className="ab-summary-card">
              <span className="ab-summary-label">Signal Agreement</span>
              <span className="ab-summary-value" style={{ color: comparison.agreeRate >= 75 ? '#22c55e' : comparison.agreeRate >= 50 ? '#f59e0b' : '#ef4444' }}>
                {comparison.agreeRate.toFixed(0)}%
              </span>
              <span className="ab-summary-note">{comparison.agreeCount} agree · {comparison.divergeCount} diverge</span>
            </div>
            <div className="ab-summary-card">
              <span className="ab-summary-label">Direction Bias</span>
              <div className="ab-bias-bar">
                <div className="ab-bias-seg ab-bias-both-bullish" style={{ flex: comparison.directionBias.bothBullish || 0.1 }} title="Both BUY" />
                <div className="ab-bias-seg ab-bias-a-bullish" style={{ flex: comparison.directionBias.aBullish || 0.1 }} title="Only A BUY" />
                <div className="ab-bias-seg ab-bias-neutral" style={{ flex: 1 }} title="Neither BUY" />
                <div className="ab-bias-seg ab-bias-b-bullish" style={{ flex: comparison.directionBias.bBullish || 0.1 }} title="Only B BUY" />
                <div className="ab-bias-seg ab-bias-both-bearish" style={{ flex: comparison.directionBias.bothBearish || 0.1 }} title="Both SELL" />
              </div>
              <span className="ab-summary-note">
                A bullish: {comparison.directionBias.aBullish + comparison.directionBias.bothBullish} · B bullish: {comparison.directionBias.bBullish + comparison.directionBias.bothBullish}
              </span>
            </div>
            <div className="ab-summary-card">
              <span className="ab-summary-label">Max Divergence</span>
              <span className="ab-summary-value">
                {comparison.rows[0] ? `${comparison.rows[0].symbol} (Δ${Math.abs(comparison.rows[0].diff).toFixed(0)})` : '—'}
              </span>
            </div>
          </div>

          {/* View mode tabs */}
          <div className="ab-view-tabs">
            <button className={`ab-view-tab ${viewMode === 'signals' ? 'active' : ''}`} onClick={() => setViewMode('signals')}>📊 Signal Comparison</button>
            <button className={`ab-view-tab ${viewMode === 'directives' ? 'active' : ''}`} onClick={() => setViewMode('directives')}>🔍 Directive Analysis</button>
            <button className={`ab-view-tab ${viewMode === 'outcomes' ? 'active' : ''}`} onClick={() => setViewMode('outcomes')}>📈 Outcome Tracking</button>
          </div>

          {/* Signal Comparison Table */}
          {viewMode === 'signals' && (
            <section className="ab-section">
              <div className="ab-table-wrap">
                <table className="ab-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th colSpan="2" className="ab-col-proto-a">{comparison.protoAName}</th>
                      <th colSpan="2" className="ab-col-proto-b">{comparison.protoBName}</th>
                      <th>Δ Score</th>
                      <th>Agreement</th>
                    </tr>
                    <tr className="ab-subhead">
                      <th></th>
                      <th>Score</th><th>Signal</th>
                      <th>Score</th><th>Signal</th>
                      <th></th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map(row => (
                      <tr key={row.symbol} className={row.agree ? 'ab-row-agree' : 'ab-row-diverge'}>
                        <td><strong>{row.symbol}</strong></td>
                        <td className="ab-score-a">{row.scoreA.toFixed(0)}</td>
                        <td>
                          <span className="ab-signal-chip" style={{ background: SIGNAL_COLORS[row.signalA], color: '#fff' }}>
                            {row.signalA}
                          </span>
                        </td>
                        <td className="ab-score-b">{row.scoreB.toFixed(0)}</td>
                        <td>
                          <span className="ab-signal-chip" style={{ background: SIGNAL_COLORS[row.signalB], color: '#fff' }}>
                            {row.signalB}
                          </span>
                        </td>
                        <td className={`ab-diff ${row.diff > 0 ? 'ab-diff-a' : row.diff < 0 ? 'ab-diff-b' : ''}`}>
                          {row.diff > 0 ? '+' : ''}{row.diff.toFixed(0)}
                        </td>
                        <td>
                          {row.agree
                            ? <span className="ab-agree-badge agree">Match</span>
                            : <span className="ab-agree-badge diverge">Diverge</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Directive Analysis */}
          {viewMode === 'directives' && (
            <section className="ab-section">
              <Notice level="info">
                Directive-level comparison requires per-protocol directive breakdown from the backend.
                Running {comparison.protoAName} ({protocols.find(p => p.id === protoA)?.directiveCount || '?'} directives)
                vs {comparison.protoBName} ({protocols.find(p => p.id === protoB)?.directiveCount || '?'} directives).
              </Notice>

              {/* Show where they diverge most */}
              <h3>🔴 Where Do They Disagree Most?</h3>
              <div className="ab-diverge-list">
                {comparison.rows
                  .filter(r => !r.agree)
                  .slice(0, 6)
                  .map(row => (
                    <motion.div
                      key={row.symbol}
                      className="ab-diverge-card"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                    >
                      <div className="ab-diverge-head">
                        <strong>{row.symbol}</strong>
                        <span className="ab-diverge-diff">Δ {Math.abs(row.diff).toFixed(0)} points</span>
                      </div>
                      <div className="ab-diverge-split">
                        <div className="ab-diverge-side">
                          <span className="ab-diverge-label">{comparison.protoAName}</span>
                          <span className="ab-signal-chip" style={{ background: SIGNAL_COLORS[row.signalA], color: '#fff' }}>{row.signalA}</span>
                          <span className="ab-diverge-score">Score: {row.scoreA.toFixed(0)}</span>
                        </div>
                        <span className="ab-diverge-arrow">→</span>
                        <div className="ab-diverge-side">
                          <span className="ab-diverge-label">{comparison.protoBName}</span>
                          <span className="ab-signal-chip" style={{ background: SIGNAL_COLORS[row.signalB], color: '#fff' }}>{row.signalB}</span>
                          <span className="ab-diverge-score">Score: {row.scoreB.toFixed(0)}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                {comparison.rows.filter(r => !r.agree).length === 0 && (
                  <p className="ab-empty">Perfect agreement — no divergence found.</p>
                )}
              </div>
            </section>
          )}

          {/* Outcome Tracking */}
          {viewMode === 'outcomes' && (
            <section className="ab-section">
              <Notice level="info">
                Outcome tracking compares forward returns for each protocol's signals independently.
                Requires running both protocols over a historical period and comparing P&L, win rate,
                and risk-adjusted metrics. Coming in a future phase.
              </Notice>
              <div className="ab-outcome-placeholder">
                <h3>📈 Outcome Comparison</h3>
                <p>Track how Protocol A and Protocol B signals perform over time:</p>
                <ul>
                  <li>Forward returns per signal direction</li>
                  <li>Win rate comparison (BUY/SELL accuracy)</li>
                  <li>Profit factor and Sharpe ratio per protocol</li>
                  <li>Statistical significance (t-test over N observations)</li>
                </ul>
              </div>
            </section>
          )}
        </>
      )}

      <p className="ab-footer">
        Auto-refresh every 30s · {symbols.length} symbols in watchlist
        {' · '}
        <button type="button" className="ab-refresh-link" onClick={() => { scoreAQuery.refetch(); scoreBQuery.refetch(); }}>
          Refresh now
        </button>
      </p>
    </div>
  );
}
