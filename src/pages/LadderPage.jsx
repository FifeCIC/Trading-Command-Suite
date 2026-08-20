/**
 * Live Ordering Stack (Ladder) — the original SEES presentation.
 * =============================================================
 * Animated card ladder. Every symbol in a protocol's resolvedSymbols is
 * ranked by its live SEES score, and the cards slide into a new position as
 * scores change — the highest-conviction opportunity is always on top.
 *
 * Data access is SHARED with the Symbols Ladder (no new ways to reach the
 * data — same endpoints, different design):
 *   - GET /api/scoring/gated/protocols → active protocols + resolvedSymbols
 *   - GET /api/scoring/runs            → latest per-symbol scores
 *
 * @uses useProtocolData()   (src/core/useProtocolData.js)
 * @uses buildScoreDisplay() (src/core/score-display.js)
 * @uses SignalBadge         (src/components/SignalBadge.jsx)
 */
import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import SignalBadge from '../components/SignalBadge';
import { buildScoreDisplay } from '../core/score-display';
import { useProtocolStatuses } from '../core/protocol-status';
import { useProtocolData } from '../core/useProtocolData';
import { usePersistentState, usePersistentChoice } from '../hooks/usePersistentState';
import './ladder.css';

const AGE_OPTIONS = ['1', '2', '3', '4', '5', '10', '15', '20', '30', '60'];

const DIRECTION_OPTIONS = [
  ['all', 'All'],
  ['long', 'LONG'],
  ['short', 'SHORT'],
];

/**
 * Is a protocol applicable to the given direction view?
 * BOTH protocols trade both directions, so they apply to LONG and SHORT alike.
 * LONG_ONLY / SHORT_ONLY only apply to their own view.
 */
function isDirectionApplicable(p, direction) {
  if (direction === 'all') return true;
  const mode = p.directionMode || 'LONG_ONLY';
  if (direction === 'long') return mode !== 'SHORT_ONLY';
  if (direction === 'short') return mode !== 'LONG_ONLY';
  return true;
}

/** Relative time — "12s ago", "5m ago", "2h ago". */
function timeAgo(iso) {
  if (!iso) return '—';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 0) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Read the Screen Options "Score Display" preference (raw | percent | both). */
function readScoreDisplay() {
  try { return localStorage.getItem('lad-score-display') || 'both'; }
  catch { return 'both'; }
}

/**
 * One labeled score block — used for BOTH the Signal and Opportunity scores so
 * they render identically. Value format follows the Screen Options preference
 * (raw | percent | both). `active` highlights the metric the ladder is ranked by.
 */
function ScoreBlock({ label, score, max, pct, mode, active }) {
  const raw = score != null
    ? `${score.toLocaleString()}${max ? ` / ${max.toLocaleString()}` : ''}`
    : null;
  const pctNode = pct != null ? `${pct}%` : null;
  const value = mode === 'raw'
    ? raw
    : mode === 'percent'
      ? pctNode
      : null;
  return (
    <span className={`lad-score-block ${active ? 'lad-score-block--active' : ''}`}>
      <span className="lad-score-label">{label}</span>
      {value != null ? (
        <span className="lad-score-value">{value ?? '—'}</span>
      ) : (
        <span className="lad-score-value">
          <span>{raw ?? '—'}</span>
          {pctNode && <span className="lad-score-pct">{pctNode}</span>}
        </span>
      )}
    </span>
  );
}

export default function LadderPage() {
  const { protocols, runs, isLoading } = useProtocolData();
  const { statusMap } = useProtocolStatuses();
  // Filter / sort selections persist across navigation.
  const [selectedIds, setSelectedIds] = usePersistentState('ladder:selectedIds', []);
  const [ageFilter, setAgeFilter] = usePersistentChoice('ladder:ageFilter', 'all', ['all', ...AGE_OPTIONS]);
  const [rankBy, setRankBy] = usePersistentChoice('ladder:rankBy', 'signal', ['signal', 'opp']);

  // Direction view — All / LONG / SHORT. Driven by the ?direction= URL param
  // (written back so the view is shareable) and persisted across navigation.
  const [searchParams, setSearchParams] = useSearchParams();
  const [direction, setDirection] = usePersistentChoice('ladder:direction', 'all', ['all', 'long', 'short']);

  // Apply the ?direction= URL param on mount (validated against allowed values).
  useEffect(() => {
    const urlDir = (searchParams.get('direction') || '').toLowerCase();
    if (urlDir && ['all', 'long', 'short'].includes(urlDir)) {
      setDirection(urlDir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Change the view, keeping the URL in sync so LONG/SHORT are shareable.
  const changeDirection = (d) => {
    setDirection(d);
    const next = new URLSearchParams(searchParams);
    if (d === 'all') next.delete('direction');
    else next.set('direction', d.toUpperCase());
    setSearchParams(next, { replace: true });
  };

  // Screen Options: how to render each card's score (raw | percent | both).
  const [scoreDisplay, setScoreDisplay] = useState(readScoreDisplay);

  // Poll localStorage for Screen Options changes (same-tab doesn't fire 'storage').
  useEffect(() => {
    const interval = setInterval(() => {
      setScoreDisplay((prev) => {
        const current = readScoreDisplay();
        return prev !== current ? current : prev;
      });
    }, 250);
    return () => clearInterval(interval);
  }, []);

  // Active protocols only — inactive ones are skipped (matches the ladders).
  const activeProtocols = useMemo(
    () => protocols.filter((p) => p.active !== false),
    [protocols],
  );

  // Only show protocols that can actually score. no-data (no market bars) and
  // paused (non-ready directives) produce empty cards, so hide them from the
  // selection list.
  const selectableProtocols = useMemo(
    () => activeProtocols.filter((p) => {
      const st = statusMap[p.id]?.state;
      return st !== 'no-data' && st !== 'paused';
    }),
    [activeProtocols, statusMap],
  );

  // Partition selectable protocols by whether they apply to the current
  // direction view. In All mode every protocol is applicable.
  const applicableProtocols = useMemo(
    () => selectableProtocols.filter((p) => isDirectionApplicable(p, direction)),
    [selectableProtocols, direction],
  );
  const nonApplicableProtocols = useMemo(
    () => selectableProtocols.filter((p) => !isDirectionApplicable(p, direction)),
    [selectableProtocols, direction],
  );

  // Prune selections to applicable protocols and auto-select the first one when
  // nothing applicable is selected (e.g. after switching LONG → SHORT).
  useEffect(() => {
    const applicableIds = new Set(applicableProtocols.map((p) => p.id));
    const kept = selectedIds.filter((id) => applicableIds.has(id));
    if (kept.length !== selectedIds.length) {
      setSelectedIds(kept);
    } else if (kept.length === 0 && applicableProtocols.length > 0) {
      setSelectedIds([applicableProtocols[0].id]);
    }
  }, [direction, applicableProtocols, selectedIds, setSelectedIds]);

  const selectedProtocols = applicableProtocols.filter((p) => selectedIds.includes(p.id));

  const toggleProtocol = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // Build symbol→score lookup from the scoring runs (latest run per symbol+protocol).
  const scoreMap = useMemo(() => {
    const map = {};
    for (const run of runs) {
      const proto = run.protocolId || run.strategyId;
      for (const s of run.scores || []) {
        const ticker = (s.ticker || s.symbol || '').toUpperCase();
        if (!ticker) continue;
        const key = `${ticker}::${proto}`;
        // Runs are timestamp-desc, so the first match per key is the latest.
        if (!map[key]) {
          map[key] = {
            value: s.value,
            signal: s.signal ?? null,
            rawComposite: s.rawComposite ?? s.value,
            rawMax: s.rawMax ?? null,
            opportunityScore: s.opportunityScore ?? null,
            opportunityMax: s.opportunityMax ?? null,
            marketStatus: s.marketStatus ?? null,
            timestamp: run.timestamp,
          };
        }
      }
    }
    return map;
  }, [runs]);

  // Partition the selected protocols' cards into those passing all filters and
  // those excluded by them. Excluded cards are still shown below a divider so
  // the user can see which protocols/cards aren't making the ladder.
  const { passing, excluded } = useMemo(() => {
    const all = [];
    for (const p of selectedProtocols) {
      for (const sym of p.resolvedSymbols || []) {
        const ticker = sym.toUpperCase();
        const raw = scoreMap[`${ticker}::${p.id}`] || null;
        all.push({
          symbol: ticker,
          protocolId: p.id,
          protocolName: p.name || p.id,
          raw,
          vm: buildScoreDisplay(raw ?? {}),
          hasScore: !!raw,
          time: raw?.timestamp ?? null,
        });
      }
    }

    const sorter = (a, b) => {
      if (a.hasScore !== b.hasScore) return a.hasScore ? -1 : 1;
      const key = rankBy === 'opp' ? 'opportunityPct' : 'pct';
      const sa = a.vm[key] ?? -1;
      const sb = b.vm[key] ?? -1;
      return sb - sa;
    };

    // Score-age filter — matches the Symbols Ladder's staleness filter.
    // Unscored rows have no timestamp, so they never pass a non-'all' age.
    if (ageFilter === 'all') {
      all.sort(sorter);
      return { passing: all, excluded: [] };
    }
    const cutoff = Date.now() - Number(ageFilter) * 60_000;
    const pass = all.filter((e) => e.time && new Date(e.time).getTime() >= cutoff);
    const excl = all.filter((e) => !(e.time && new Date(e.time).getTime() >= cutoff));
    pass.sort(sorter);
    excl.sort(sorter);
    return { passing: pass, excluded: excl };
  }, [selectedProtocols, scoreMap, ageFilter, rankBy]);

  const scoredCount = passing.filter((e) => e.hasScore).length;

  // One card renderer — used for both the ladder and the excluded section.
  const renderCard = (e, i, dimmed) => (
    <motion.div
      key={`${e.protocolId}::${e.symbol}`}
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className={`lad-card ${i === 0 && !dimmed ? 'lad-card--top' : ''} ${dimmed ? 'lad-card--filtered' : ''}`}
    >
      <div className="lad-card-head">
        <span className="lad-rank">#{i + 1}</span>
        <Link
          className="lad-symbol"
          to={`/research/symbol/${encodeURIComponent(e.symbol)}`}
          title={`Open ${e.symbol}`}
        >
          {e.symbol}
        </Link>
        <span className="lad-proto-tag">{e.protocolName}</span>
        <span className="lad-card-status">
          <SignalBadge display={e.vm} />
          <span className={`lad-state lad-state--${e.vm.state}`}>
            {e.vm.frozen ? 'Market closed' : 'Live'}
          </span>
        </span>
      </div>
      <div className="lad-card-foot">
        <div className="lad-card-scores">
          <ScoreBlock
            label="Signal"
            score={e.vm.score}
            max={e.vm.scoreMax}
            pct={e.vm.pct}
            mode={scoreDisplay}
            active={rankBy === 'signal'}
          />
          {e.vm.opportunityPct != null && (
            <ScoreBlock
              label="Opp"
              score={e.vm.opportunityScore}
              max={e.vm.opportunityMax}
              pct={e.vm.opportunityPct}
              mode={scoreDisplay}
              active={rankBy === 'opp'}
            />
          )}
        </div>
        <span className="lad-time"><span className="lad-time-label">Scored: </span>{e.time ? timeAgo(e.time) : 'no score'}</span>
      </div>
    </motion.div>
  );

  if (isLoading) {
    return (
      <div className="lad-page">
        <header className="lad-header"><h1>Ladder</h1></header>
        <LoadingSkeleton variant="card" count={5} />
      </div>
    );
  }

  return (
    <div className="lad-page">
      {/* ── Header ── */}
      <header className="lad-header">
        <div>
          <h1>Ladder
            <PageInfoPopover>
              The original SEES view — a live-ranked card ladder. Every symbol in a
              protocol's paired symbols is ranked by scoring strength, and the cards
              slide into place as scores change. Reuses the same scoring data as the
              Symbols Ladder.
            </PageInfoPopover>
          </h1>
          <p className="lad-subtitle">
            {selectedIds.length} protocol{selectedIds.length === 1 ? '' : 's'} · {passing.length} in ladder
            {excluded.length > 0 ? ` · ${excluded.length} filtered` : ''} · {scoredCount} scored
          </p>
        </div>
      </header>

      {/* ── Two-column split: protocols left, cards right ── */}
      <div className="lad-split">
        {/* Left — protocol selection list */}
        <aside className="lad-proto-col">
          <h2 className="lad-proto-title">
            {direction === 'all' ? 'Active Protocols' : 'Applicable Protocols'}
          </h2>
          {applicableProtocols.length === 0 ? (
            <p className="lad-proto-empty">No {direction === 'all' ? 'active' : 'applicable'} protocols.</p>
          ) : (
            <ul className="lad-proto-list">
              {applicableProtocols.map((p) => (
                <li key={p.id}>
                  <label className="lad-proto-item">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(p.id)}
                      onChange={() => toggleProtocol(p.id)}
                    />
                    <span className="lad-proto-name">{p.name ?? p.id}</span>
                    <span className="lad-proto-count">{(p.resolvedSymbols || []).length}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {direction !== 'all' && nonApplicableProtocols.length > 0 && (
            <>
              <h3 className="lad-proto-subtitle">Non-Applicable Protocols</h3>
              <ul className="lad-proto-list">
                {nonApplicableProtocols.map((p) => (
                  <li key={p.id} className="lad-proto-item--disabled">
                    <label className="lad-proto-item">
                      <input type="checkbox" disabled />
                      <span className="lad-proto-name">{p.name ?? p.id}</span>
                      <span className="lad-proto-count">{(p.resolvedSymbols || []).length}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        {/* Right — cards stacked in score order */}
        <main className="lad-cards-col">
          <div className="lad-toolbar">
            <div className="lad-direction" role="group" aria-label="Direction">
              {DIRECTION_OPTIONS.map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  className={`lad-dir-btn ${direction === val ? 'lad-dir-btn--active' : ''}`}
                  onClick={() => changeDirection(val)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="lad-filter">
              Score by:
              <select value={rankBy} onChange={(e) => setRankBy(e.target.value)}>
                <option value="signal">Signal</option>
                <option value="opp">Opportunity</option>
              </select>
            </label>
            <label className="lad-filter">
              Score age:
              <select value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)}>
                <option value="all">All</option>
                {AGE_OPTIONS.map((m) => <option key={m} value={m}>≤ {m}m</option>)}
              </select>
            </label>
          </div>
          {selectedIds.length === 0 ? (
            <div className="lad-empty">
              <p className="lad-empty-title">Select a protocol to build the ladder.</p>
              <p>Each protocol ranks its symbols by live SEES score; the cards stack in score order.</p>
            </div>
          ) : passing.length === 0 && excluded.length === 0 ? (
            <div className="lad-empty">
              <p className="lad-empty-title">No symbols for the selected protocols.</p>
              <p>None of the selected protocols have resolved symbols to rank yet.</p>
            </div>
          ) : (
            <>
              {passing.length > 0 && (
                <motion.div layout className="lad-stack">
                  <AnimatePresence mode="popLayout">
                    {passing.map((e, i) => renderCard(e, i, false))}
                  </AnimatePresence>
                </motion.div>
              )}
              {excluded.length > 0 && (
                <>
                  <div className="lad-divider">
                    <span className="lad-divider-label">Not passing filters</span>
                    <span className="lad-divider-note">
                      {excluded.length} card{excluded.length === 1 ? '' : 's'} outside the selected score-age filter
                    </span>
                  </div>
                  <motion.div layout className="lad-stack">
                    <AnimatePresence mode="popLayout">
                      {excluded.map((e, i) => renderCard(e, i, true))}
                    </AnimatePresence>
                  </motion.div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
