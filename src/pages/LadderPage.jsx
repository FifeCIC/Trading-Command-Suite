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
import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import SignalBadge from '../components/SignalBadge';
import { buildScoreDisplay } from '../core/score-display';
import { useProtocolStatuses } from '../core/protocol-status';
import { useProtocolData } from '../core/useProtocolData';
import { usePersistentState, usePersistentChoice } from '../hooks/usePersistentState';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { timeAgo } from '../core/format-utils';
import './ladder.css';

const AGE_OPTIONS = ['1', '2', '3', '4', '5', '10', '15', '20', '30', '60'];

const DIRECTION_OPTIONS = [
  ['all', 'BOTH'],
  ['long', 'LONG'],
  ['short', 'SHORT'],
];

const MARKET_OPTIONS = [
  ['open', 'Open'],
  ['all', 'All'],
  ['closed', 'Closed'],
];

/**
 * Does a card's market state match the market filter?
 * - 'open' (default): only symbols backed by an open market (marketStatus.open === true)
 * - 'closed': only symbols with a confirmed closed market
 * - 'all': everything (incl. unknown-market / unscored rows)
 */
function marketMatches(e, filter) {
  const open = e.vm.marketStatus?.open;
  if (filter === 'open') return open === true;
  if (filter === 'closed') return open === false;
  return true;
}

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

/** Read the Screen Options "Score Display" preference (raw | percent | both). */
function readScoreDisplay() {
  try { return localStorage.getItem('lad-score-display') || 'both'; }
  catch { return 'both'; }
}

/**
 * Card state vocabulary — the single place that decides what a card's state chip
 * says and how it is coloured. Every card renders exactly one chip with one of
 * these values, so a card that is somehow in the wrong state is spottable by
 * reading the chip rather than by spotting a missing element.
 *
 * Deliberately a fixed map instead of string building: an unexpected
 * `vm.state` falls back to the unscored style rather than emitting a
 * `lad-state--undefined` class that would silently render unstyled.
 */
const STATE_CLASS = {
  live: 'lad-state--live',
  paused: 'lad-state--paused',
  stale: 'lad-state--stale',
  unscored: 'lad-state--unscored',
  closed: 'lad-state--closed',
};

/** Human label for a card's state chip. See STATE_CLASS for the vocabulary. */
function stateLabel(vm) {
  if (vm.state === 'unscored') return 'Not scored';
  if (vm.frozen) return vm.state === 'stale' ? 'Stale' : 'Market closed';
  return 'Live';
}

/** CSS modifier for a card's state chip — the label/colour pair in one place. */
function stateClass(vm) {
  if (vm.state === 'unscored') return STATE_CLASS.unscored;
  if (!vm.frozen) return STATE_CLASS[vm.state] || STATE_CLASS.live;
  return vm.state === 'stale' ? STATE_CLASS.stale : STATE_CLASS.closed;
}

/**
 * One-time migration helper: the pre-direction-selection build stored a single
 * flat array of protocol ids (the BOTH view). Read it so those selections carry
 * into the BOTH bucket of the new per-direction memory.
 */
function readLegacySelectedIds() {
  try {
    const old = JSON.parse(localStorage.getItem('tcs:view-state:ladder:selectedIds') || 'null');
    return Array.isArray(old) ? old : [];
  } catch { return []; }
}

/**
 * familyOf(protocolId) — the protocol FAMILY a run belongs to.
 *
 * The gated-protocol registry and the run store name the same strategy slightly
 * differently: the registry uses `xau-speed-v1` while runs are emitted per
 * timeframe as `xau-speed-m5` / `-m15` / `-1h` / `-4h`. Dropping the version
 * suffix (`-v1`) and the trailing timeframe gives the shared family key, so a
 * card can find its score whichever name produced it.
 */
function familyOf(protocolId) {
  return String(protocolId || '')
    .toLowerCase()
    .replace(/-v\d+$/, '')                    // xau-speed-v1   -> xau-speed
    .replace(/-(m1|m5|m15|m30|h1|h4|d1|w1|mn1|\d+[mhd])$/, ''); // xau-speed-m5 -> xau-speed
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

/** Numeric helpers for the opt-in facts strip (#667/#668). */
function fmtVal(v, d = 2) { return v == null ? '—' : Number(v).toFixed(d); }
function fmtSigned(v) {
  if (v == null) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

/**
 * Opt-in facts strip on a Ladder card (#667/#668, phase-6 preview — shown only
 * when the ladder's "Details" toggle is on). Company/stock facts come from the
 * stored symbol registry; our own trading stats come from the stored
 * open-position map. Renders nothing (graceful) when neither is available.
 */
function LadderFacts({ meta, pos }) {
  const co = meta && meta.name && String(meta.name).trim().toUpperCase() !== String(meta.ticker || '').toUpperCase()
    ? meta.name
    : null;
  const pnl = pos && typeof pos.pnl === 'number' ? pos.pnl : null;
  const pnlPct = pos && typeof pos.pnlPct === 'number' ? pos.pnlPct : null;
  if (!co && !pos) return null;
  return (
    <div className="lad-facts">
      {co && (
        <span className="lad-fact" title={[meta.exchange, meta.type].filter(Boolean).join(' · ') || 'Company'}>
          {co}
        </span>
      )}
      {pos && (
        <span
          className={`lad-fact lad-fact--pos${pnl != null ? (pnl >= 0 ? ' lad-pnl-up' : ' lad-pnl-down') : ''}`}
          title={`Open position${pos.provider ? ` · ${pos.provider}` : ''}`}
        >
          ● {fmtVal(pos.quantity, 2)} @ {fmtVal(pos.avgPrice)} → {fmtVal(pos.currentPrice)}
          {pnl != null && (
            <span className="lad-fact-pnl"> · P&L {fmtSigned(pnl)} ({fmtSigned(pnlPct)}%)</span>
          )}
        </span>
      )}
    </div>
  );
}

export default function LadderPage() {
  const cardsColRef = useRef(null); // scroll-reveal scope (issue #672)
  const { protocols, runs, isLoading } = useProtocolData();
  const { statusMap } = useProtocolStatuses();
  // Filter / sort selections persist across navigation. Protocol selections are
  // stored PER direction, so toggling BOTH/LONG/SHORT restores each view's own
  // chosen protocols instead of wiping them.
  const [selectedByDir, setSelectedByDir] = usePersistentState('ladder:selectedByDir', {
    all: readLegacySelectedIds(),
    long: [],
    short: [],
  });
  const [ageFilter, setAgeFilter] = usePersistentChoice('ladder:ageFilter', 'all', ['all', ...AGE_OPTIONS]);
  const [rankBy, setRankBy] = usePersistentChoice('ladder:rankBy', 'signal', ['signal', 'opp']);

  // Market status filter — default Open, so the ladder shows only symbols
  // backed by an open market. Persists across navigation.
  const [marketFilter, setMarketFilter] = usePersistentChoice('ladder:market', 'open', ['open', 'all', 'closed']);

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

  // Issue #667/#668 — opt-in "Details": company/stock facts + our own trading
  // stats on each card. DEFAULT OFF so the production ladder is unchanged
  // (phase-6 scope; surfaced behind a toggle). Reads are single STORED GETs,
  // enabled lazily only when the toggle is on — no on-page imports.
  const [showFacts, setShowFacts] = usePersistentState('ladder:showFacts', false);
  const posQuery = useQuery({
    queryKey: ['symbols-positions'],
    queryFn: () => apiGet('/api/symbols/positions'),
    enabled: showFacts,
    staleTime: 60_000,
  });
  const positionBySymbol = useMemo(() => {
    const m = {};
    (Array.isArray(posQuery.data?.positions) ? posQuery.data.positions : [])
      .forEach((p) => { if (p?.symbol) m[String(p.symbol).toUpperCase()] = p; });
    return m;
  }, [posQuery.data]);
  const metaQuery = useQuery({
    queryKey: ['all-symbols-meta'],
    queryFn: () => apiGet('/api/symbols').catch(() => ({ symbols: [] })),
    enabled: showFacts,
    staleTime: 120_000,
  });
  const symbolMeta = useMemo(() => {
    const m = {};
    (Array.isArray(metaQuery.data?.symbols) ? metaQuery.data.symbols : [])
      .forEach((s) => { if (s?.ticker) m[String(s.ticker).toUpperCase()] = s; });
    return m;
  }, [metaQuery.data]);

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

  // The active selection set is the current direction's own bucket.
  const selectedIds = selectedByDir[direction] || [];

  // Prune ONLY the current direction's selections to applicable protocols and
  // auto-select the first one when nothing applicable is selected. Other
  // directions' selections are left untouched so they're restored on toggle-back.
  useEffect(() => {
    const applicableIds = new Set(applicableProtocols.map((p) => p.id));
    const cur = selectedByDir[direction] || [];
    const kept = cur.filter((id) => applicableIds.has(id));
    if (kept.length !== cur.length) {
      setSelectedByDir((prev) => ({ ...prev, [direction]: kept }));
    } else if (kept.length === 0 && applicableProtocols.length > 0) {
      setSelectedByDir((prev) => ({ ...prev, [direction]: [applicableProtocols[0].id] }));
    }
  }, [direction, applicableProtocols, selectedByDir, setSelectedByDir]);

  const selectedProtocols = applicableProtocols.filter((p) => selectedIds.includes(p.id));

  const toggleProtocol = (id) => {
    setSelectedByDir((prev) => {
      const cur = (prev && prev[direction]) || [];
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      return { ...prev, [direction]: next };
    });
  };

  // Build symbol→score lookup from the scoring runs (latest run per symbol+protocol).
  //
  // ⚠️ WHY THERE ARE TWO MAPS. The ladder keys a card by `symbol::protocolId` using
  // the id from /api/scoring/gated/protocols (e.g. `xau-speed-v1`), but the run
  // store keys the same symbol by the TIMEFRAME variant that produced it
  // (`xau-speed-m5`, `xau-speed-m15`, `xau-speed-1h`, `xau-speed-4h`). An exact
  // match therefore misses the speed/scalp protocols entirely: `XAUUSD::xau-speed-v1`
  // is absent while `XAUUSD::xau-speed-m5` is present.
  //
  // Deleting the `-v1` suffix — the same rule the ladder already uses below for
  // per-protocol filtering, where a protocol is "relevant" to a run when either id
  // is a prefix of the other — reconciles them. Two maps instead of one because a
  // direct hit must always beat a family hit: if a protocol ever does emit its own
  // run, that exact score wins and this is inert.
  const { scoreMap, familyMap } = useMemo(() => {
    const exact = {};
    const family = {};
    for (const run of runs) {
      const proto = run.protocolId || run.strategyId;
      for (const s of run.scores || []) {
        const ticker = (s.ticker || s.symbol || '').toUpperCase();
        if (!ticker) continue;
        // Runs are timestamp-desc, so the first match per key is the latest.
        const row = {
          value: s.value,
          signal: s.signal ?? null,
          rawComposite: s.rawComposite ?? s.value,
          rawMax: s.rawMax ?? null,
          opportunityScore: s.opportunityScore ?? null,
          opportunityMax: s.opportunityMax ?? null,
          marketStatus: s.marketStatus ?? null,
          timestamp: run.timestamp,
          // Which protocol emitted this row — the card footer always names it.
          protocolId: proto,
        };
        const key = `${ticker}::${proto}`;
        if (!exact[key]) exact[key] = row;

        // Family key: drop the version suffix and the trailing timeframe.
        // `xau-speed-m5` and `xau-speed-v1` both become `xau-speed`.
        const fam = `${ticker}::${familyOf(proto)}`;
        const prev = family[fam];
        if (!prev || Date.parse(run.timestamp) > Date.parse(prev.timestamp)) {
          family[fam] = { ...row, sourceProtocolId: proto };
        }
      }
    }
    return { scoreMap: exact, familyMap: family };
  }, [runs]);

  // Partition the selected protocols' cards into those passing all filters and
  // those excluded by them. Excluded cards are still shown below a divider so
  // the user can see which protocols/cards aren't making the ladder.
  const { passing, excluded } = useMemo(() => {
    const all = [];
    for (const p of selectedProtocols) {
      for (const sym of p.resolvedSymbols || []) {
        const ticker = sym.toUpperCase();
        // Exact run for this protocol id first; otherwise the family fallback
        // (see the scoreMap note above). `borrowed` marks the fallback so the
        // card can say which timeframe the number actually came from.
        const exact = scoreMap[`${ticker}::${p.id}`] || null;
        const borrowed = exact ? null : (familyMap[`${ticker}::${familyOf(p.id)}`] || null);
        const raw = exact || borrowed;
        all.push({
          symbol: ticker,
          protocolId: p.id,
          protocolName: p.name || p.id,
          raw,
          vm: buildScoreDisplay(raw ?? {}),
          hasScore: !!raw,
          time: raw?.timestamp ?? null,
          // The protocol id that actually produced the number. Equal to this
          // card's protocolId for an exact match; the sibling's id when borrowed.
          runId: raw?.protocolId ?? null,
          // Only a genuine cross-timeframe borrow gets the "via" chip. When the
          // family fallback resolves back to this card's own protocol id there is
          // nothing borrowed, and chipping it would just duplicate the run id.
          scoreFrom: borrowed && borrowed.sourceProtocolId !== p.id ? borrowed.sourceProtocolId : null,
          // Adaptive Target (2026-09-10). `adaptiveTargetActive` is true only when the
          // target is enabled AND rests on enough observations to actually move the
          // denominator — a flag-on-but-inactive protocol is NOT badged, because its
          // scores are still on the configured scale and a badge would mislead.
          adaptiveTargetActive: !!p.adaptiveTargetActive,
          adaptiveTargetMax: p.adaptiveTargetMax ?? null,
        });
      }
    }

    // Market status filter — default (Open) hides closed-market symbols so the
    // ladder shows only cards backed by an open market.
    const list = marketFilter === 'all' ? all : all.filter((e) => marketMatches(e, marketFilter));

    const sorter = (a, b) => {
      // Rank on whether the card is actually actionable BEFORE score size.
      // A frozen (market-closed) scan is a historical read, not a live signal —
      // it must never outrank a live score, which is what happened when
      // `spy-day-v1`/`qqq-day-v1` (closed) sat above a live Gold BUY.
      const ta = a.hasScore && !a.vm.frozen ? 1 : 0;
      const tb = b.hasScore && !b.vm.frozen ? 1 : 0;
      if (ta !== tb) return tb - ta;
      if (a.hasScore !== b.hasScore) return a.hasScore ? -1 : 1;
      const key = rankBy === 'opp' ? 'opportunityPct' : 'pct';
      const sa = a.vm[key] ?? -1;
      const sb = b.vm[key] ?? -1;
      return sb - sa;
    };

    // Score-age filter — matches the Symbols Ladder's staleness filter.
    // Unscored rows have no timestamp, so they never pass a non-'all' age.
    if (ageFilter === 'all') {
      list.sort(sorter);
      return { passing: list, excluded: [] };
    }
    const cutoff = Date.now() - Number(ageFilter) * 60_000;
    const pass = list.filter((e) => e.time && new Date(e.time).getTime() >= cutoff);
    const excl = list.filter((e) => !(e.time && new Date(e.time).getTime() >= cutoff));
    pass.sort(sorter);
    excl.sort(sorter);
    return { passing: pass, excluded: excl };
  }, [selectedProtocols, scoreMap, familyMap, ageFilter, rankBy, marketFilter]);

  const scoredCount = passing.filter((e) => e.hasScore).length;

  // Reveal-on-scroll (issue #672). Cards below the fold fade/slide in as they
  // enter the viewport. SAFE BY DESIGN: any card already within the viewport is
  // revealed immediately (before paint, no flash), cards are never left hidden
  // while visible, and if IntersectionObserver is unavailable everything is
  // revealed. popLayout/reordering/exit are untouched because we only observe an
  // inner content div (.lad-reveal) inside the existing motion.div card.
  useLayoutEffect(() => {
    const root = cardsColRef.current;
    if (!root) return;
    const ioSupported = typeof IntersectionObserver !== 'undefined';
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const revealAll = () => root.querySelectorAll('.lad-reveal').forEach((el) => {
      el.classList.add('lad-reveal--show');
      el.dataset.revealed = '1';
    });
    // Safety: never leave cards hidden. If IO is unavailable OR we cannot
    // reliably measure the viewport (e.g. headless/embedded contexts where
    // innerHeight is 0), reveal everything rather than risk stuck-hidden cards.
    if (!ioSupported || vh <= 0) { revealAll(); return; }
    const observers = [];
    root.querySelectorAll('.lad-reveal').forEach((el) => {
      if (el.dataset.revealed === '1') return;
      const reveal = () => { el.classList.add('lad-reveal--show'); el.dataset.revealed = '1'; };
      const r = el.getBoundingClientRect();
      if (r.top < vh - 24 && r.bottom > 0) { reveal(); return; } // already in viewport
      const io = new IntersectionObserver((entries, obs) => {
        if (entries.some((en) => en.isIntersecting)) { reveal(); obs.disconnect(); }
      }, { threshold: 0.05, rootMargin: '0px 0px -24px 0px' });
      io.observe(el);
      observers.push(io);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, [passing, excluded]);

  // One card renderer — used for both the ladder and the excluded section.
  const renderCard = (e, i, dimmed) => (
    <motion.div
      key={`${e.protocolId}::${e.symbol}`}
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className={`lad-card ${i === 0 && !dimmed ? 'lad-card--top' : ''} ${dimmed ? 'lad-card--filtered' : ''} ${e.vm.state !== 'unscored' && e.vm.frozen ? 'lad-card--closed' : ''}`}
    >
      <div className="lad-reveal">
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
        {/* Adaptive Target badge (2026-09-10) — this protocol's percentage is measured
            against its own observed peak, NOT its configured capacity. Shown on the card
            itself (not just the registry) because the whole risk of this feature is a
            reader comparing two percentages that sit on different scales without knowing.
            Deliberately a word, not just a colour, so it survives colour-blind rendering. */}
        {e.adaptiveTargetActive && (
          <span
            className="lad-target-badge"
            title={
              `Adaptive Target — measured against this protocol's observed peak` +
              `${e.adaptiveTargetMax != null ? ` (${Math.round(e.adaptiveTargetMax)})` : ''}, ` +
              `not its configured capacity. The peak only ever rises.`
            }
          >
            target
          </span>
        )}
        <span className="lad-card-status">
          <SignalBadge display={e.vm} />
          {/* ONE state chip on every card — never a different element or a
              missing chip. Values: Live / Market closed / Stale / Not scored.
              Unscored rows must NOT claim "Live" (that reads as a live tradable
              signal next to a blank score), so they get their own value here
              rather than swapping the markup out. */}
          <span className={`lad-state ${stateClass(e.vm)}`}>
            {stateLabel(e.vm)}
          </span>
        </span>
      </div>
      {showFacts && (
        <LadderFacts
          meta={symbolMeta[String(e.symbol).toUpperCase()] || null}
          pos={positionBySymbol[String(e.symbol).toUpperCase()] || null}
        />
      )}
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
          {/* Both score slots always render. Previously "Opp" was omitted when
              null, so an unscored card was visibly SHORTER than a scored one and
              the whole row shifted. An empty slot is the honest and consistent
              presentation: the protocol genuinely has no Opportunity score. */}
          <ScoreBlock
            label="Opp"
            score={e.vm.opportunityScore}
            max={e.vm.opportunityMax}
            pct={e.vm.opportunityPct}
            mode={scoreDisplay}
            active={rankBy === 'opp'}
          />
        </div>
        {/* Footer meta — the SAME slots in the SAME order on every card, so a
            card that is missing something is visibly missing it rather than just
            looking shorter. Slot 1: age, or an explicit no-run word. Slot 2: the
            run that produced the number, always shown. Slot 3: a badge when this
            protocol had no run of its own and the number came from a sibling. */}
        <span className="lad-time">
          {e.time ? (
            <>
              <span className="lad-time-label">Scored: </span>{timeAgo(e.time)}
              <span className="lad-time-src" title={`Scoring run: ${e.runId || e.protocolId}`}> · {e.runId || e.protocolId}</span>
              {e.scoreFrom && (
                <span
                  className="lad-time-borrow"
                  title={`${e.protocolId} produced no run — showing ${e.scoreFrom} instead`}
                >
                  borrowed
                </span>
              )}
            </>
          ) : (
            <span className="lad-time-none">No scoring run yet</span>
          )}
        </span>
      </div>
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
        {/* Control row — spans BOTH columns so it has the full width for more controls.
            It is a grid sibling (not nested in either column), which is what lets it sit
            above the protocol list as well as the cards. */}
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
          <label className="lad-filter">
            Market:
            <select value={marketFilter} onChange={(e) => setMarketFilter(e.target.value)}>
              {MARKET_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </label>
          <label className="lad-filter" title="Show company facts & your open-position stats on each card (phase-6 preview, #667/#668)">
            <input type="checkbox" checked={showFacts} onChange={(e) => setShowFacts(e.target.checked)} />
            Details
          </label>
        </div>

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
        <main className="lad-cards-col" ref={cardsColRef}>
          {selectedIds.length === 0 ? (
            <div className="lad-empty">
              <p className="lad-empty-title">Select a protocol to build the ladder.</p>
              <p>Each protocol ranks its symbols by live SEES score; the cards stack in score order.</p>
            </div>
          ) : passing.length === 0 && excluded.length === 0 ? (
            <div className="lad-empty">
              <p className="lad-empty-title">
                {marketFilter === 'open'
                  ? 'No open-market symbols for the selected protocols.'
                  : 'No symbols for the selected protocols.'}
              </p>
              <p>
                {marketFilter === 'open'
                  ? 'All matched cards are for a closed market. Switch the Market filter to All or Closed to see them.'
                  : 'None of the selected protocols have resolved symbols to rank yet.'}
              </p>
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
