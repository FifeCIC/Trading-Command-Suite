/**
 * Strategy Monitor — Unified Dashboard
 * ======================================
 * Single merged view (2026-08-31): stat grid + filters + sl-card strategy
 * cards. Former Overview / Strategies / Compare tabs were consolidated into
 * one scrollable view; comparison lives at /trading/strategy-comparison.
 *
 * Data: /api/trading/strategies/with-ratios, /api/automation/status
 *
 * @created 2026-07-29 — #504 strategy page consolidation
 */

import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet, apiPost } from '../core/api/client';
import { dismissSignal, fetchScoringThresholds } from '../core/api/signals';
import { timeAgo } from '../core/format-utils';
// noticeLine() — the coded one-liner. A table cell cannot hold a NoticeBlock, and the point here is
// the CODE, which is what makes the row's failure joinable to the API log.
import { noticeLine } from '../core/notices/registry.js';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import PageInfoPopover from '../components/PageInfoPopover';
import { scoreClass, signalClass } from '../core/signal-utils';
import { thresholdGeometry, standingClass } from '../core/score-display';
import { isActiveStrategy, isTradingStrategy, isScoringStrategy } from '../core/strategy-filters';
import StrategyFaultBadge from '../components/StrategyFaultBadge';
import './strategy-monitor.css';
// ⚠️ The BOT CARD vocabulary is shared with StrategiesListPage and is a MODULE, so its names are
// hashed and cannot be reached from another stylesheet. It used to be a plain `strategies-list.css`
// whose `sl-` prefix was claimed by four other page stylesheets plus index.css, and every property
// in it was being overridden at runtime (measured 2026-09-18: its `.sl-page` padding 24px/32px was
// computing as 16px/24px).
// ⚠️ `sl-chip-queue` is deliberately NOT from this module - it is defined in strategy-monitor.css
// and is unique to this page.
import styles from './strategies-list.module.css';

export default function StrategyMonitorPage() {
  const [expandedBotId, setExpandedBotId] = useState(null);
  const [queueSearch, setQueueSearch] = useState('');
  const [queueSort, setQueueSort] = useState('depth');
  const [rowResults, setRowResults] = useState({});
  const queryClient = useQueryClient();

  // ── Shared data ──
  const { data: strategies = [], isLoading: stratLoading } = useQuery({
    queryKey: ['monitor-strategies'],
    queryFn: () => apiGet('/api/trading/strategies/with-ratios').catch(() => ({ strategies: [] })),
    refetchInterval: 15_000,
  });
  const stratList = Array.isArray(strategies) ? strategies : (strategies?.strategies || strategies?.viable || []);

  const { data: autoStatus } = useQuery({
    queryKey: ['monitor-auto'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 15_000,
  });

  const { data: mt5Diag } = useQuery({
    queryKey: ['monitor-mt5'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    refetchInterval: 30_000,
  });

  // ── Signal queues (#714 Stage 2) — pending entries per trading bot ──
  const { data: queueEntries = [], isLoading: queueLoading } = useQuery({
    queryKey: ['monitor-queues'],
    queryFn: () => apiGet('/api/trading/strategies/queues').catch(() => []),
    refetchInterval: 15_000,
  });
  const queueList = Array.isArray(queueEntries) ? queueEntries : [];

  // ── Live thresholds — the scale the *Pct columns are measured on (#847) ──
  //
  // ⚠️ `compositePct` / `signalPct` / `opportunityPct` are PERCENT-OF-CAPACITY (ADR-011). Measured
  // live 2026-09-16: compositePct and signalPct are 7-17, opportunityPct 34-45. They must NOT be
  // passed to `scoreClass()`, which classifies a 0-100 score against 65/40 — no 7-17 value can ever
  // clear 40, so every queued signal rendered as "low" while the server called some of them
  // BUY/STRONG. Percentages go through `thresholdGeometry()` against the scale they were measured
  // on. `combinedStrength` is different: measured 18-74, a real 0-100 score, and keeps
  // `scoreClass()`.
  //
  // The scale is read from the server rather than remembered here — the same rule broker-utils.js
  // documents for the style bars, and the mistake that let a hand-copied bar survive the
  // 2026-09-15 rescale (#839).
  const { data: thresholdData } = useQuery({
    queryKey: ['scoring-thresholds'],
    queryFn: fetchScoringThresholds,
    staleTime: 300_000,
  });
  const scale = thresholdData?.classification ?? null;

  const queueBots = useMemo(() => {
    const byStrat = new Map();
    for (const e of queueList) {
      if (!byStrat.has(e.strategyId)) {
        byStrat.set(e.strategyId, {
          strategyId: e.strategyId,
          name: e.strategyName || e.strategyId,
          symbol: e.strategySymbol,
          mode: e.strategyMode,
          active: e.strategyActive,
          entries: [],
        });
      }
      byStrat.get(e.strategyId).entries.push(e);
    }
    const q = (queueSearch || '').trim().toUpperCase();
    let bots = [...byStrat.values()].map(b => {
      const entries = q
        ? b.entries.filter(e => e.symbol?.toUpperCase().includes(q)
            || (e.protocolId || '').toUpperCase().includes(q)
            || b.name.toUpperCase().includes(q))
        : b.entries;
      return { ...b, entries, depth: entries.length, top: Math.max(...entries.map(e => e.combinedStrength || 0), 0) };
    });
    if (q) bots = bots.filter(b => b.entries.length > 0);
    bots = bots.sort((a, b) => queueSort === 'strength'
      ? b.top - a.top
      : b.depth - a.depth || b.top - a.top);
    return bots;
  }, [queueList, queueSearch, queueSort]);

  const queueDepthByStrategy = useMemo(() => {
    const m = new Map();
    for (const e of queueList) m.set(e.strategyId, (m.get(e.strategyId) || 0) + 1);
    return m;
  }, [queueList]);

  // Execute a queued signal — triggers the bot's existing execute path.
  const executeMutation = useMutation({
    mutationFn: ({ strategyId, entryId }) => apiPost(`/api/trading/strategies/${strategyId}/execute`),
    onSuccess: (res, vars) => {
      const text = res?.executed
        ? '✅ Executed'
        : `⛔ ${res?.reason || (res?.evaluated ? 'Conditions not met' : 'Not executed')}`;
      setRowResults(prev => ({ ...prev, [vars.entryId]: text }));
      queryClient.invalidateQueries({ queryKey: ['monitor-queues'] });
    },
    onError: (err, vars) => {
      setRowResults(prev => ({ ...prev, [vars.entryId]: '❌ ' + noticeLine('TCS-SYS-007', { operation: 'execute the strategy', detail: err }) }));
    },
  });

  // Dismiss a queued signal — propagates into the queue (#714) and Signals (#684).
  const dismissMutation = useMutation({
    mutationFn: ({ entry }) => dismissSignal({
      symbol: entry.symbol,
      protocolId: entry.protocolId,
      hours: 1,
      strengths: {
        combinedStrength: entry.combinedStrength,
        signalPct: entry.signalPct,
        opportunityPct: entry.opportunityPct,
      },
    }),
    onSuccess: (_, vars) => {
      setRowResults(prev => ({ ...prev, [vars.entry.id]: '🚫 Dismissed 1h' }));
      queryClient.invalidateQueries({ queryKey: ['monitor-queues'] });
      queryClient.invalidateQueries({ queryKey: ['signals-best'] });
    },
    onError: (err, vars) => {
      setRowResults(prev => ({ ...prev, [vars.entry.id]: '❌ ' + noticeLine('TCS-SYS-007', { operation: 'dismiss the signal', detail: err }) }));
    },
  });

  // ── Compute overview stats ──
  const overview = useMemo(() => {
    const active = stratList.filter(isActiveStrategy);
    const trading = active.filter(isTradingStrategy);
    const scoring = active.filter(isScoringStrategy);
    const withScore = active.filter(s => s.lastComposite != null);
    const avgScore = withScore.length > 0
      ? Math.round(withScore.reduce((sum, s) => sum + s.lastComposite, 0) / withScore.length)
      : 0;
    return { total: stratList.length, active: active.length, trading: trading.length, scoring: scoring.length, avgScore };
  }, [stratList]);

  const loopRunning = autoStatus?.loopEnabled;
  const tickCount = autoStatus?.tickCount || 0;
  const lastTickMs = autoStatus?.lastTickMs || 0;

  // ── Monitored set: active trading strategies only (this is a Monitor view) ──
  const monitoredStrats = useMemo(
    () => stratList.filter(s => isActiveStrategy(s) && isTradingStrategy(s)),
    [stratList],
  );

  // ── Broker chips — dynamic from automation brokerStates (mt5, trading212, …) ──
  const brokerStates = autoStatus?.brokerStates || {};
  const brokerChips = Object.entries(brokerStates).map(([brokerId, bs]) => {
    const label = String(brokerId).toUpperCase();
    const connected = Boolean(bs?.enabled);
    const trading = Boolean(bs?.tradingEnabled);
    const balance = brokerId === 'mt5' ? mt5Diag?.balance : null;
    const account = brokerId === 'mt5' ? mt5Diag?.accountName : null;
    const status = trading ? 'Trading' : connected ? 'Connected' : 'Offline';
    // ── THE SAME MEANING WAS WRITTEN TWICE ──────────────────────────────────────────────────────
    // `strategy-monitor.css` already resolves these three states with `--color-profit`,
    // `--color-warning` and `--color-muted`, so the page carried each colour as BOTH a token and a
    // literal. A literal never follows the theme: it is fixed the day it is typed, so the two
    // expressions of one meaning can only ever drift. Measured 2026-09-25: 13 hex literals in this
    // file against 32 token references in its stylesheet.
    const color = trading ? 'var(--color-profit)' : connected ? 'var(--color-warning)' : 'var(--color-muted)';
    const icon = trading ? '🟢' : connected ? '🟡' : '⚫';
    return { brokerId, label, status, color, icon, balance, account };
  });

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="sm-page">
      <motion.header className="sm-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Bot Monitor</h1>
          <p className="sm-subtitle">
            {overview.active} active · {overview.trading} trading · {overview.scoring} scoring · avg score {overview.avgScore}
          </p>
        </div>
        <div className="sm-loop-badge" style={{ background: loopRunning ? 'color-mix(in srgb, var(--color-profit) 9%, transparent)' : 'color-mix(in srgb, var(--color-muted) 9%, transparent)', color: loopRunning ? 'var(--color-profit)' : 'var(--color-muted)' }}>
          {loopRunning ? '🟢 Loop Active' : '⚫ Loop Stopped'} · Tick #{tickCount} · {lastTickMs}ms
        </div>
      </motion.header>

      {/* Single merged view: stats → filters → cards */}
      <motion.div className="sm-tab-content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        {/* Stat cards */}
        <div className="sm-stat-grid">
          <div className="sm-stat"><span className="sm-stat-val">{overview.total}</span><span className="sm-stat-label">Total</span></div>
          <div className="sm-stat"><span className="sm-stat-val pl-score-high">{overview.active}</span><span className="sm-stat-label">Active</span></div>
          <div className="sm-stat"><span className="sm-stat-val" style={{ color: 'var(--color-accent-blue)' }}>{overview.trading}</span><span className="sm-stat-label">Trading</span></div>
          {/* Avg Score is the mean of `lastComposite` values — an average has NO server
              classification, so it renders MUTED ("cannot judge") instead of being graded against
              a remembered bar. Measured 2026-09-20: `lastComposite` spans 9-108 and its own units
              are the #909 open question; #847 closed the misclassification class. */}
          <div className="sm-stat"><span className="sm-stat-val pl-muted">{overview.avgScore}</span><span className="sm-stat-label">Avg Score</span></div>
          {brokerChips.map(bc => (
            <div
              key={bc.brokerId}
              className="sm-stat"
              title={bc.account ? `${bc.label} · ${bc.account} · ${bc.status}` : `${bc.label} · ${bc.status}`}
            >
              <span className="sm-stat-val" style={{ color: bc.color }}>{bc.icon} {bc.label}</span>
              <span className="sm-stat-label">
                {bc.status === 'Trading'
                  ? 'Trading'
                  : bc.balance != null
                    ? `Balance ${bc.balance}`
                    : bc.status}
              </span>
            </div>
          ))}
        </div>

        {/* The LIVE-STATE table. Superseded the accordion card grid on 2026-09-25: the cards and
            Trading Bots' table rendered the same rows in two shapes with no stated split. */}
        {/* ── LIVE STATE ──────────────────────────────────────────────────────────────────────
            The heading is load-bearing, not decoration. Trading Bots renders these SAME rows as a
            TABLE and this page renders them as CARDS, which is how the two were reported as "
            basically the same page but they aren't the same thing". With no stated division of
            labour a reader has to infer it from the columns.

            This page answers "what is happening NOW" (live score, queue depth, faults); Trading
            Bots answers "what exists and how is it configured". The link makes the second half
            reachable from here instead of duplicated here. */}
        <div className="sm-live-head">
          <h2>Live state</h2>
          <span className="sm-monitor-note">
            What is happening now. Configuration lives on{' '}
            <Link to="/trading/trading-bots">Trading Bots</Link>.
          </span>
        </div>

        {stratLoading ? <LoadingSkeleton variant="card" count={6} /> : monitoredStrats.length === 0 ? (
          <EmptyState icon="◆" title="No active trading strategies" description="Activate a trading strategy to see monitoring data." />
        ) : (
          <div className={styles.tablePane}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Bot</th>
                  <th scope="col">Symbol</th>
                  <th scope="col">Type</th>
                  <th scope="col">Watchlist</th>
                  <th scope="col">Protocol</th>
                  <th scope="col" className={styles.thNum}>Broker</th>
                  <th scope="col" className={styles.thNum}>
                    Score
                    <PageInfoPopover>
                      <strong>Protocol-scoped gated composite (0–100%).</strong>
                      <br />
                      The strategy's latest evaluation, expressed as a percentage of the protocol's
                      maximum score. The Scoring ladder shows a different, dual scale — raw Signal
                      (x/max) plus raw Opportunity (x/max) with percentages — so numbers there
                      look larger. Click the score to see the live ordering stack.
                    </PageInfoPopover>
                  </th>
                  <th scope="col" className={styles.thNum}>Queued</th>
                </tr>
              </thead>
              <tbody>
            {monitoredStrats.map((s) => {
              const isActive = isActiveStrategy(s);
              const isTrading = isTradingStrategy(s);
              const isScoring = isScoringStrategy(s);
              const typeLabel = isTrading ? 'Trading' : isScoring ? 'Scoring' : 'Strategy';
              // `--ink-soft` for the neutral case, NOT `#94a3b8`: that literal is what `--ink-soft`
              // USED TO BE. index.css records the change — "was #94a3b8 — boosted for WCAG AA on
              // #000000" — so the literal silently pins this page to the pre-boost, lower-contrast
              // value while every other page gets the corrected one.
              // ⚠️ `isScoring` keeps a literal because NO canonical purple token exists; inventing
              // an app-wide one is a decision above this page's remit. Declared, not quietly left.
              const typeColor = isTrading ? 'var(--color-accent-blue)' : isScoring ? '#8b5cf6' : 'var(--ink-soft)';

              return (
                <tr key={s.id} className={styles.row}>
                  <td>
                    <span className={styles.nameCell}>
                      <span className={styles.cardDot} style={{ background: isActive ? 'var(--risk-normal)' : 'var(--ink-soft)' }} />
                      <Link to={`/trading/strategy/${s.id}`} className={styles.chipLink} title="Open the full rules view for this bot">
                        {s.name}
                      </Link>
                    </span>
                    <StrategyFaultBadge strategy={s} className={styles.rowFault} />
                  </td>
                  <td>
                    {s.symbol && (
                      <Link
                        to="/scoring/symbols-ladder"
                        className={`${styles.chip} ${styles.chipLink}`}
                        title={`Open ${s.symbol} in the symbols ladder`}
                        onClick={e => e.stopPropagation()}
                      >
                        {s.symbol}
                      </Link>
                    )}
                  </td>
                  <td>
                    <span className={styles.cardType} style={{ background: `color-mix(in srgb, ${typeColor} 12%, transparent)`, color: 'var(--ink)', borderColor: typeColor }}>
                      {typeLabel}
                    </span>
                  </td>
                  <td className={styles.tdMuted}>{s.watchlistName || '—'}</td>
                  <td>
                    <Link to="/protocols/protocols-registry" className={styles.chipLink} title={`Open protocol registry — this strategy consumes ${s.protocolId || 'no protocol'}`}>
                      {s.protocolId || '—'}
                    </Link>
                  </td>
                  <td className={styles.tdNum}>{s.brokerId || '—'}</td>
                  <td className={styles.tdNum}>
                    {/* Colour = the SERVER's classification for this evaluation (`lastSignal`) —
                        measured 2026-09-20: `scoreClass(15)` painted 11 of 18 BUY rows RED while
                        the server called them BUY. `lastComposite` is the #909 two-unit column,
                        so it cannot be graded locally even once its units are settled (#847). */}
                    {s.lastComposite != null ? (
                      <Link
                        to="/scoring/live-ordering-stack"
                        className={signalClass(s.lastSignal)}
                        title="Open the live ordering stack (Scoring)"
                      >
                        {s.lastComposite}
                      </Link>
                    ) : (
                      <span className={styles.tdMuted}>—</span>
                    )}
                  </td>
                  <td className={styles.tdNum}>
                    {queueDepthByStrategy.get(s.id) > 0 ? (
                      <span
                        className={`${styles.chip} sl-chip-queue`}
                        title={`${queueDepthByStrategy.get(s.id)} pending signal(s) — see Signal Queues below`}
                      >
                        ⏳ {queueDepthByStrategy.get(s.id)}
                      </span>
                    ) : (
                      <span className={styles.tdMuted}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
              </tbody>
            </table>
          </div>
        )}

        {/* Signal Queues (#714 Stage 2) — bots as queues of signals */}
        <section className="sm-queues">
          <div className="sm-queues-header">
            <h2>
              Signal Queues
              <PageInfoPopover>
                <strong>Every trading bot is a queue of signals.</strong>
                <br />
                The one scoring line routes actionable signals into each bot's queue based on
                its protocol subscriptions. Re-signals refresh the entry; when a symbol stops
                signalling the entry is voided. Dismissals propagate both ways.
              </PageInfoPopover>
            </h2>
            <div className="sm-queues-controls">
              <input
                className="smq-search"
                placeholder="Filter symbol, protocol, bot…"
                value={queueSearch}
                onChange={e => setQueueSearch(e.target.value)}
              />
              <select className="smq-sort" value={queueSort} onChange={e => setQueueSort(e.target.value)}>
                <option value="depth">Sort: Queue depth</option>
                <option value="strength">Sort: Strength</option>
              </select>
            </div>
          </div>

          {queueLoading && queueList.length === 0 ? <LoadingSkeleton variant="card" count={2} /> : queueBots.length === 0 ? (
            <EmptyState
              icon="⏳"
              title={queueList.length === 0 ? 'No pending signals' : 'No bots match the filter'}
              description={queueList.length === 0
                ? 'When the scoring line signals a symbol a trading bot subscribes to, it will appear here.'
                : 'Try a different symbol, protocol, or bot name.'}
            />
          ) : (
            <div className="smq-list">
              {queueBots.map((bot, i) => {
                const expanded = expandedBotId === bot.strategyId;
                return (
                  <motion.div
                    key={bot.strategyId}
                    className={`smq-bot ${expanded ? 'smq-bot--open' : ''}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <button
                      type="button"
                      className="smq-bot-row"
                      onClick={() => setExpandedBotId(expanded ? null : bot.strategyId)}
                      aria-expanded={expanded}
                    >
                      <span className="smq-chevron">{expanded ? '▾' : '▸'}</span>
                      <span className="smq-bot-dot" style={{ background: bot.active !== false ? 'var(--color-profit)' : 'var(--ink-soft)' }} />
                      <strong className="smq-bot-name">{bot.name}</strong>
                      {bot.symbol && <span className="smq-bot-symbol">{bot.symbol}</span>}
                      <span className="smq-bot-mode">{bot.mode || '—'}</span>
                      <span className="smq-depth" title="Pending signals in this bot's queue">
                        {bot.depth} pending
                      </span>
                    </button>
                    {expanded && (
                      <div className="smq-entries">
                        {bot.entries.map(e => (
                          <div key={e.id} className="smq-entry">
                            <span className="smq-entry-symbol">
                              <Link to="/scoring/symbols-ladder" className={styles.chipLink}>{e.symbol}</Link>
                            </span>
                            <span className={`smq-entry-dir smq-entry-dir--${(e.direction || 'long').toLowerCase()}`}>
                              {e.direction === 'SHORT' ? 'SELL' : e.direction === 'LONG' ? 'BUY' : e.direction || '—'}
                            </span>
                            <span className="smq-entry-proto">
                              <Link to="/protocols/protocols-registry" className={styles.chipLink}>{e.protocolId}</Link>
                            </span>
                            <span className="smq-entry-scores" title="SEES dual score at signal time — composite · signal · opportunity">
                                <span className={standingClass(thresholdGeometry(e.compositePct, scale).standing)}>{e.compositePct ?? '—'}</span>
                                <i>C</i>
                                <span className={standingClass(thresholdGeometry(e.signalPct, scale).standing)}>{e.signalPct ?? '—'}</span>
                                <i>S</i>
                                <span className={standingClass(thresholdGeometry(e.opportunityPct, scale).standing)}>{e.opportunityPct ?? '—'}</span>
                              <i>O</i>
                            </span>
                            <span className={`smq-entry-strength ${scoreClass(e.combinedStrength)}`} title="Combined strength">
                              {e.combinedStrength}
                            </span>
                            <span className="smq-entry-age" title={e.createdAt}>{timeAgo(e.createdAt)}</span>
                            <span className="smq-entry-actions">
                              <button
                                type="button"
                                className="smq-btn smq-btn--go"
                                disabled={executeMutation.isPending || dismissMutation.isPending}
                                title="Run this bot now (respects mode, cooldown and position limits)"
                                onClick={() => executeMutation.mutate({ strategyId: bot.strategyId, entryId: e.id })}
                              >
                                ▶ Execute
                              </button>
                              <button
                                type="button"
                                className="smq-btn smq-btn--dismiss"
                                disabled={executeMutation.isPending || dismissMutation.isPending}
                                title="Dismiss for 1h — removes this queue entry and the Signals card"
                                onClick={() => dismissMutation.mutate({ entry: e })}
                              >
                                ✕
                              </button>
                            </span>
                            {rowResults[e.id] && <span className="smq-entry-result">{rowResults[e.id]}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>
      </motion.div>

    </div>
  );
}
