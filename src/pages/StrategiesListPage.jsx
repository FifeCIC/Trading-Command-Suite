/**
 * Strategies List — Canonical Strategy Index
 * ===========================================
 * Replaces the scattered strategy list views. Single source of truth
 * for "what strategies exist and what are they doing right now."
 *
 * Data: GET /api/trading/strategies + portfolio cross-reference
 *
 * @created 2026-07-29 — #504 strategy page consolidation
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet, apiPost } from '../core/api/client';
import { noticeFromError } from '../core/notices/from-error.js';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import ToggleSwitch from '../components/ToggleSwitch';
import { filterStrategies, isActiveStrategy, isTradingStrategy, isScoringStrategy, isFaultyStrategy } from '../core/strategy-filters';
import StrategyFaultBadge from '../components/StrategyFaultBadge';
import styles from './strategies-list.module.css';

const API = '/api/trading/strategies';

// ── Helpers ──────────────────────────────────────────────

// ⚠️ THEMED tokens, and `color-mix()` rather than the old `typeColor + '18'` hex-alpha trick.
// Appending an alpha suffix only works on a HEX literal - `var(--risk-normal)18` is invalid CSS, so
// the moment these became variables the old concatenation would have silently produced no colour.
const STATUS_COLORS = {
  active: 'var(--risk-normal)', enabled: 'var(--accent)',
  paused: 'var(--risk-elevated)', disabled: 'var(--ink-soft)', stopped: 'var(--ink-soft)',
};

/** How many protocol chips to show before collapsing the rest into "+N more". */
const MAX_PROTOCOL_CHIPS = 3;

/**
 * ProtocolChips — ONE CHIP PER SUBSCRIPTION, because a bot can serve MANY protocols.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS READS `protocols` AND NOT `protocolId`
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * This card rendered `s.protocolId` — the LEGACY single-protocol column. The real relationship is
 * `strategy_protocol`, a JOIN TABLE, so a bot can accept and execute signals from several META.Stack
 * pipelines at once. `bot-rules.ts` declares `protocolId` as `display-only` with the caveat "Legacy
 * single protocol link; seeds one subscription and is used for the bot label", and signal routing
 * joins `strategy_protocol` — never `protocolId`.
 *
 * ⚠️ THE TWO CAN DISAGREE, AND THAT IS THE POINT. Measured 2026-09-18: `Hourly Triple-Directive
 * Control` carries `protocolId = 'hourly-3dir-v1'` but has ZERO subscriptions. The old card showed
 * it as wired. Routing joins `strategy_protocol`, so it can never receive a signal — a bot that
 * LOOKS configured and silently does nothing.
 *
 * Measured in the same pass: all 26 bots had exactly ONE subscription and one had none, so "many"
 * was unexercised. The card was shaped for data that had never taken that form.
 */
function ProtocolChips({ strategies }) {
  const subs = Array.isArray(strategies.protocols) ? strategies.protocols : [];

  if (subs.length === 0) {
    // Name the legacy column so the disagreement is visible, not implied. This is the
    // "configured but silent" case, which is different from "nothing set".
    return (
      <span
        className={`${styles.chip} ${styles.chipFaulty}`}
        title="Routing joins strategy_protocol. With no row there, this bot receives no signals."
      >
        {strategies.protocolId ? `no subscription (shows ${strategies.protocolId})` : 'no protocol'}
      </span>
    );
  }

  const shown = subs.slice(0, MAX_PROTOCOL_CHIPS);
  const overflow = subs.length - shown.length;

  return (
    <>
      {shown.map((sub) => (
        <span
          key={sub.id || sub.protocolId}
          className={`${styles.chip} ${styles.chipProto}`}
          title={`${sub.protocolId} — ${sub.role || 'role unset'}`}
        >
          {sub.protocolId}
          {sub.role ? <em className={styles.chipRole}>{String(sub.role).toUpperCase()}</em> : null}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className={`${styles.chip} ${styles.chipMore}`}
          title={subs.map((x) => `${x.protocolId} (${x.role || 'no role'})`).join(', ')}
        >
          +{overflow} more
        </span>
      )}
    </>
  );
}

export default function StrategiesListPage() {
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('all'); // all | active | trading | scoring | faulty
  const [toggleError, setToggleError] = useState(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // ── Strategies ──
  // ⚠️ NOT `.catch(() => [])`. That catch turned every failure into an empty list, so `isError`
  // could never become true and the `Unable to load strategies` state below was DEAD CODE. A dead
  // API rendered `No strategies - Create one to start trading or scoring.`, which is a different
  // and more alarming statement than "the request failed". Let it throw, and let `isError` work.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['strategies-list'],
    queryFn: async () => {
      const res = await apiGet(API);
      return Array.isArray(res) ? res : (res?.strategies || res?.viable || []);
    },
    refetchInterval: 15_000,
  });
  const strategies = useMemo(() => data || [], [data]);

  // Faulty strategies (pending_bars or blocked)
  const faultyStrategies = useMemo(() => {
    if (!strategies?.length) return [];
    return strategies.filter(isFaultyStrategy);
  }, [strategies]);

  // ── Portfolio cross-ref ──
  const { data: positions = [] } = useQuery({
    queryKey: ['strategies-list-positions'],
    queryFn: () => apiGet('/api/portfolio?source=mt5').catch(() => ({ positions: [] })),
    refetchInterval: 60_000,
  });

  const posBySymbol = useMemo(() => {
    const map = {};
    for (const p of (positions?.positions || positions || [])) {
      const sym = (p.symbol || p.ticker || '').toUpperCase();
      map[sym] = (map[sym] || 0) + 1;
    }
    return map;
  }, [positions]);

  // ── Filter ──
  const filtered = useMemo(() => filterStrategies(strategies, filter), [strategies, filter]);

  const handleToggle = async (id) => {
    setToggleError(null);
    const previous = strategies.find((s) => s.id === id);
    // Optimistic — update cache immediately, then confirm with the server
    queryClient.setQueryData(['strategies-list'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(s => s.id === id ? { ...s, active: !s.active } : s);
    });
    try {
      // ⚠️ `fetch` resolves on 4xx/5xx - it only rejects on a transport failure. The previous
      // version chained `.catch()` alone, so a REJECTED toggle was treated as a success, the
      // optimistic flip was never rolled back, and the card showed a state the server did not
      // have. Only a dead network reverted, which is the rarer case.
      await apiPost(`${API}/${id}/toggle`);
    } catch (e) {
      // Roll back explicitly, then say so. A kill switch that silently fails to flip is a
      // trading-safety surface, not a cosmetic one: the operator believes the bot is stopped.
      queryClient.setQueryData(['strategies-list'], (old) => {
        if (!Array.isArray(old) || !previous) return old;
        return old.map(s => s.id === id ? { ...s, active: previous.active } : s);
      });
      setToggleError({ id, notice: noticeFromError(e, 'TCS-SYS-007', { operation: 'change this bot' }) });
    }
  };

  // ── Render ─────────────────────────────────────────────

  if (isLoading) return <div className={styles.page}><LoadingSkeleton variant="card" count={3} /></div>;

  return (
    <div className={styles.page}>
      <motion.header className={styles.header} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Trading Bots</h1>
          <p className={styles.subtitle}>
            {isError ? 'Could not load bots' : `${strategies.length} bots — trading, scoring, and monitoring`}
          </p>
        </div>
        <div className={styles.filterBar}>
          {['all', 'active', 'trading', 'scoring', 'faulty'].map(f => (
            <button
              key={f}
              className={`${styles.filterChip} ${filter === f ? styles.filterActive : ''} ${f === 'faulty' ? styles.filterFaulty : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </motion.header>

      {isError && (
        <EmptyState
          icon="⚠️"
          title="Unable to load bots"
          description="The request to GET /api/trading/strategies failed. This is a failed read, NOT an empty registry — no bot has been deleted or disabled. Check the API is running."
        />
      )}
      {toggleError && (
        <div className={styles.toggleError} role="alert">
          <strong>{toggleError.notice.title}</strong> {toggleError.notice.message}
          {toggleError.notice.action ? ` ${toggleError.notice.action}` : ''}
        </div>
      )}
      {!isLoading && faultyStrategies.length > 0 && filter !== 'faulty' && (
        <div className={styles.faultyBanner}>
          <span>⚠️ {faultyStrategies.length} bot{faultyStrategies.length !== 1 ? 's' : ''} with data issues</span>
          <button className={styles.faultyBannerBtn} onClick={() => setFilter('faulty')}>View faulty</button>
        </div>
      )}
      {/* ⚠️ `!isError` is load-bearing. Without it a FAILED read renders "No bots" beside the error
          block, and "there are none" is a very different claim from "the request failed". */}
      {!isLoading && !isError && filtered.length === 0 && (
        <EmptyState icon="🎯" title="No bots" description="Nothing matches this filter." />
      )}

      <div className={styles.grid}>
        {filtered.map((s, i) => {
          const isActive = isActiveStrategy(s);
          const isTrading = isTradingStrategy(s);
          const isScoring = isScoringStrategy(s);
          const typeLabel = isTrading ? 'Trading' : isScoring ? 'Scoring' : 'Strategy';
          const typeColor = isTrading ? 'var(--accent)' : isScoring ? 'var(--risk-watch)' : 'var(--ink-soft)';
          const posCount = posBySymbol[s.symbol?.toUpperCase()] || 0;

          return (
            <motion.div
              key={s.id}
              className={`${styles.card} ${selectedId === s.id ? styles.cardSelected : ''}`}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => setSelectedId(selectedId === s.id ? null : s.id)}
            >
              <div className={styles.cardTop}>
                <span className={styles.cardDot} style={{ background: isActive ? STATUS_COLORS.active : STATUS_COLORS.disabled }} />
                <strong className={styles.cardName}>{s.name}</strong>
                <span className={styles.cardType} style={{ background: `color-mix(in srgb, ${typeColor} 12%, transparent)`, color: 'var(--ink)', borderColor: typeColor }}>
                  {typeLabel}
                </span>
              </div>

              <div className={styles.cardMeta}>
                {s.symbol && <span className={styles.chip}>{s.symbol}</span>}
                {s.watchlistName && <span className={`${styles.chip} ${styles.chipWl}`}>{s.watchlistName}</span>}
                <ProtocolChips strategies={s} />
                <span className={`${styles.chip} ${styles.chipBroker}`}>{s.brokerId || '—'}</span>
              </div>

              {s.lastComposite != null && (
                <div className={styles.cardScore}>
                  <span className={styles.scoreLabel}>Last Score</span>
                  <span className={styles.scoreValue} style={{ color: s.lastComposite >= 60 ? 'var(--risk-normal)' : s.lastComposite >= 40 ? 'var(--risk-elevated)' : 'var(--risk-critical)' }}>
                    {s.lastComposite}
                  </span>
                </div>
              )}

              {posCount > 0 && (
                <div className={styles.cardPositions}>
                  {posCount} open position{posCount !== 1 ? 's' : ''}
                </div>
              )}

              <StrategyFaultBadge strategy={s} className={styles.cardWarning} />

              {/* Expanded detail */}
              {selectedId === s.id && (
                <div className={styles.cardDetail}>
                  {s.description && <p className={styles.detailDesc}>{s.description}</p>}
                  <div className={styles.detailGrid}>
                    <span>Mode: <strong>{s.mode || '—'}</strong></span>
                    <span>Base Size: <strong>{s.baseSize || '—'}</strong></span>
                    <span>SL: <strong>{s.slPct != null ? s.slPct + '%' : '—'}</strong></span>
                    <span>TP: <strong>{s.tpPct != null ? s.tpPct + '%' : '—'}</strong></span>
                    <span>Min Composite: <strong>{s.minComposite || '—'}</strong></span>
                    <span>Timeframe: <strong>{s.timeframe || '—'}</strong></span>
                  </div>
                  <label className={styles.toggleRow} onClick={e => e.stopPropagation()}>
                    <span>Active</span>
                    <ToggleSwitch checked={isActive} onChange={() => handleToggle(s.id)} />
                  </label>

                  {/* Hand-off to the per-bot truth view (#864). The 6 fields above are hand-picked;
                      that page shows all 29 declared rules with each one's ENFORCEMENT status, so
                      a field like Max Positions reads here as a working cap when the live cap is
                      actually the global risk.maxOpenPositions setting. */}
                  <button
                    type="button"
                    className={styles.truthBtn}
                    onClick={(e) => { e.stopPropagation(); navigate(`/trading/strategy/${s.id}`); }}
                  >
                    Truth view — all 29 rules + enforcement →
                  </button>

                  {/* #985 §2 — the SECOND path to the SAME view, settings only. The owner's words:
                      "it could even be on the same view, but with a url parameter that displays a
                      simplified version for focusing on the configuration of the bot." A url
                      parameter rather than a second page, so there is ONE view to keep correct. */}
                  <button
                    type="button"
                    className={styles.truthBtn}
                    onClick={(e) => { e.stopPropagation(); navigate(`/trading/strategy/${s.id}?view=settings`); }}
                  >
                    Settings only — configuration without the audit →
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
