import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import Notice from '../components/Notice';
import './exit-signals.css';

const URGENCY_COLORS = {
  CRITICAL: '#dc2626',
  HIGH: '#ef4444',
  MEDIUM: '#f59e0b',
  LOW: '#22c55e',
  NONE: '#6b7280',
};

const URGENCY_LABELS = {
  CRITICAL: 'Exit Now',
  HIGH: 'Consider Exit',
  MEDIUM: 'Monitor',
  LOW: 'Strong Hold',
  NONE: 'No Signal',
};

/**
 * #1016 — THE EXIT PAGE READS THE BOT BOOK, NOT TRADING 212.
 *
 * ⚠️ WHY THE SOURCE CHANGED. `GET /api/portfolio/exit-signals` reads the **Trading 212** book via
 * `PortfolioService`, which is a data-import concern. Owner direction, 2026-09-28: *"I don't want
 * any Trading212 bot activity going forward. Only data import and updates on the status of the
 * portfolio."* The 40 bot-managed positions are MT5, and the service that evaluates them is
 * `ExitConsensusService` — `GET /api/scoring/exit-consensus`.
 *
 * ⚠️ THE SHAPES DO NOT MATCH, so this adapter IS the boundary. `ExitConsensus` answers a
 * side-dependent question ("leave THIS position?") and returns `conviction` plus five per-directive
 * verdicts. The card contract wants `urgency`, one score, and a reason list. The mapping is written
 * out field by field rather than renamed, because a silent rename here renders a confident card
 * built from the wrong field — the class of defect this repo keeps re-finding.
 */
const CONVICTION_TO_URGENCY = { EXIT: 'CRITICAL', REDUCE: 'HIGH', HOLD: 'LOW', NO_DATA: 'NONE' };

/** One `ExitAssessment` → one card. Every rendered field is derived here; none is invented. */
function toCard(a, asOf) {
  const verdicts = Array.isArray(a.verdicts) ? a.verdicts : [];
  const arguing = verdicts.filter((v) => v.arguesExit);
  const scores = verdicts.map((v) => (typeof v.score === 'number' ? v.score : 0));
  return {
    // identity — the ticket is the position, `bot` is its resolved OWNER (see #1018)
    symbol: a.symbol,
    ticker: a.ticket,
    bot: a.bot,
    side: a.side,
    urgency: CONVICTION_TO_URGENCY[a.conviction] || 'NONE',
    conviction: a.conviction,
    pnlPct: a.profitPct,
    // "Score" = the STRONGEST urgency any directive reports. A max, not an average: averaging
    // would let four calm directives drown the one that is shouting.
    currentScore: scores.length ? Math.max(...scores) : null,
    // How many of the five actually argue leaving. Shown as "2/5" so the denominator is visible —
    // two of the five can never argue an exit at all today (see #1020).
    agreeing: arguing.length,
    verdictCount: verdicts.length,
    // Only the directives that ARGUE an exit — a card listing five reasons when one argues exit
    // reads as five problems.
    reasons: (arguing.length ? arguing : verdicts.slice(0, 1)).map((v) => v.reason).filter(Boolean),
    source: 'MT5 (bot book)',
    broker: a.brokerId,
    signal: a.side,
    // Peak and give-back are the POINT of this page (#998) — carried through, not dropped.
    peakProfitPct: a.peakProfitPct ?? null,
    giveBackPct: a.giveBackPct ?? null,
    lastUpdated: asOf ?? null,
  };
}

export default function ExitSignalsPage() {
  const exitQuery = useQuery({
    queryKey: ['scoring', 'exit-consensus'],
    queryFn: () => apiGet('/api/scoring/exit-consensus'),
    refetchInterval: 30000,
  });

  const apiOnline = !exitQuery.isError;
  const isLoading = exitQuery.isLoading;
  const signals = useMemo(
    () => (Array.isArray(exitQuery.data?.assessments) ? exitQuery.data.assessments : [])
      .map((a) => toCard(a, exitQuery.data?.asOf)),
    [exitQuery.data],
  );
  const isEmpty = !isLoading && signals.length === 0;

  const summary = useMemo(() => {
    if (!Array.isArray(signals)) return null;
    const critical = signals.filter((s) => s.urgency === 'CRITICAL').length;
    const high = signals.filter((s) => s.urgency === 'HIGH').length;
    const total = signals.length;
    return { critical, high, total };
  }, [signals]);
  return (
    <div className="es-page">
      <motion.header className="es-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>🚪 Exit Signals</h1>
          <p className="es-subtitle">
            {summary
              ? `${summary.total} open positions on the bot book — ${summary.critical} exit, ${summary.high} reduce. Five exit directives evaluated per position, in isolation.`
              : 'Open-position exit evaluation — MT5 bot book'}
          </p>
        </div>
        {summary && (summary.critical > 0 || summary.high > 0) && (
          <Notice level="critical">
            <strong>Positions need attention</strong> — {summary.critical + summary.high} position{summary.critical + summary.high > 1 ? 's' : ''} flagged ({summary.critical} critical, {summary.high} high urgency).
          </Notice>
        )}
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}
      {isLoading && <LoadingSkeleton variant="text" lines={6} />}

      {isEmpty && (
        <div className="es-empty">
          <p>No open positions to evaluate.</p>
          <p className="es-hint">This page evaluates the MT5 bot book — it shows nothing when no bot holds a position. Trading 212 is data-import only and is deliberately not read here.</p>
        </div>
      )}

      {!isEmpty && Array.isArray(signals) && (
        (() => {
          // Group by urgency level
          const groups = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [], NONE: [] };
          for (const s of signals) {
            const g = s.urgency || 'NONE';
            if (groups[g]) groups[g].push(s); else groups.NONE.push(s);
          }
          const groupOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];
          const groupLabels = { CRITICAL: '⚠️ Critical — Exit Now', HIGH: '▲ High — Consider Exit', MEDIUM: '◆ Medium — Monitor', LOW: '✅ Low — Strong Hold', NONE: '— No Signal' };

          return groupOrder.map((level) => {
            const items = groups[level];
            if (!items || items.length === 0) return null;
            return (
              <div key={level} className="es-group">
                <div className={`es-group-header es-group-header-${level.toLowerCase()}`}>
                  {groupLabels[level]}
                  <span style={{ fontSize:'0.78rem', opacity:0.7 }}>({items.length})</span>
                </div>
                <div className="es-grid">
                  {items.map((sig, i) => (
                    <motion.div
                      key={sig.symbol || sig.ticker || i}
                      className="es-card"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                    >
                      <div className="es-card-header">
                        <div className="es-symbol-row">
                          <span className="es-symbol">{sig.symbol || sig.ticker}</span>
                          {sig.bot && <span className="es-bot">{sig.bot}</span>}
                          {sig.pnlPct != null && (
                            <span className={`es-pnl ${sig.pnlPct >= 0 ? 'positive' : 'negative'}`}>
                              {sig.pnlPct >= 0 ? '+' : ''}{sig.pnlPct.toFixed(1)}%
                            </span>
                          )}
                        </div>
                        <span className="es-urgency-badge" style={{ background: (URGENCY_COLORS[sig.urgency] || URGENCY_COLORS.NONE) + '20', color: URGENCY_COLORS[sig.urgency] || URGENCY_COLORS.NONE }}>
                          {URGENCY_LABELS[sig.urgency] || sig.urgency}
                        </span>
                      </div>

                      <div className="es-card-body">
                        <div className="es-metrics-row">
                          <div className="es-metric">
                            <span className="es-metric-label">Peak</span>
                            <span className="es-metric-value">
                              {sig.peakProfitPct != null ? `${sig.peakProfitPct >= 0 ? '+' : ''}${sig.peakProfitPct.toFixed(2)}%` : '—'}
                            </span>
                          </div>
                          <div className="es-metric">
                            <span className="es-metric-label">Give-back</span>
                            <span className="es-metric-value">
                              {sig.giveBackPct != null ? `−${sig.giveBackPct.toFixed(2)}%` : '—'}
                            </span>
                          </div>
                          <div className="es-metric">
                            <span className="es-metric-label">Argue exit</span>
                            <span className="es-metric-value">{sig.agreeing}/{sig.verdictCount}</span>
                          </div>
                        </div>

                        {/* ── Source + Broker info ── */}
                        <div className="es-source-row">
                          <span className={`es-source-badge ${sig.source ? 'es-source-app' : 'es-source-missing'}`}>
                            📦 {sig.source || 'Unknown Source'}
                          </span>
                          <span className={`es-source-badge ${sig.broker ? 'es-source-broker' : 'es-source-missing'}`}>
                            🏦 {sig.broker || 'Unknown Broker'}
                          </span>
                        </div>

                        {sig.reasons && sig.reasons.length > 0 && (
                          <div className="es-reasons">
                            {sig.reasons.map((reason, ri) => (
                              <div key={ri} className="es-reason">
                                {reason.startsWith('⚠️') ? reason : `• ${reason}`}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="es-actions-row">
                          {sig.urgency === 'CRITICAL' || sig.urgency === 'HIGH' ? (
                            <button type="button" className="es-action">
                              {sig.urgency === 'CRITICAL' ? 'Exit Now' : 'Review Exit'}
                            </button>
                          ) : (
                            <button type="button" className="es-action es-action-hold">Hold</button>
                          )}
                        </div>

                        {sig.lastUpdated && (
                          <div className="es-updated">
                            Updated: {new Date(sig.lastUpdated).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          });
        })()
      )}
    </div>
  );
}