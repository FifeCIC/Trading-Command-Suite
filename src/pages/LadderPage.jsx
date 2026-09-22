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
import { useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import ScoreCard from '../components/ScoreCard';
import { LadderToolbar, LadderEmptyState, LadderExcludedDivider } from '../components/LadderPanels';
import { matchesSearch } from '../core/score-card-view';
import { AGE_OPTIONS, marketMatches } from '../core/score-card-filters';
import { buildScoreEntries } from '../core/score-card-entries';
import { useProtocolStatuses } from '../core/protocol-status';
import { useProtocolData } from '../core/useProtocolData';
import { usePersistentState, usePersistentChoice } from '../hooks/usePersistentState';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useSymbolLookups } from '../hooks/useSymbolLookups';
import { useScoreDisplay } from '../hooks/useScoreDisplay';
import { useCardCopy } from '../hooks/useCardCopy';
import './ladder.css';

const DIRECTION_OPTIONS = [
  ['all', 'BOTH'],
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
 * readInitialSelection() — starting state for the per-direction protocol buckets.
 *
 * Shape: { all: string[], long: string[], short: string[], seeded: { [dir]: boolean } }
 *
 * ⚠️ WHY `seeded` EXISTS — read before simplifying this away.
 *
 * Two defects met here and produced ONE symptom: "my selections are gone after refresh".
 *
 *   1. The seed/prune effect ran BEFORE the protocol list had loaded. With no protocols,
 *      the set of applicable ids was empty, so every stored id failed the membership
 *      test and the effect **persisted the emptied array**. The next render then
 *      auto-selected a single protocol — so a 4-protocol selection became 1 on *every*
 *      refresh, which is exactly the reported bug.
 *   2. Seeding only ever chose ONE protocol (`applicableProtocols[0]`), so a first-time
 *      visitor got a one-card ladder and had to tick the rest by hand.
 *
 * `seeded` is what separates "this bucket has never been given its default" — seed it, with
 * everything — from "the user deliberately emptied this bucket", which must be left alone.
 * Without that distinction, deselecting every protocol would immediately re-select all of
 * them on the next render, which is worse than the bug being fixed.
 *
 * ⚠️ MIGRATION CHOICE — why an unmarked store is treated as UNSEEDED, not as a
 * deliberate selection worth preserving.
 *
 * When `seeded` is absent the stored buckets came from the code that HAD the defect, so
 * their contents are the corrupted output of it — typically whatever single protocol the
 * bad auto-select left behind. Preserving that would strand the user on a one-card ladder
 * and force them to re-tick every protocol by hand, which is the opposite of the intent.
 * Treating it as unseeded re-seeds each direction to ALL applicable protocols once, and the
 * `seeded` marker stops it happening again. Erring toward the inclusive default is the safe
 * direction here: an extra tick is recoverable, a silently vanished selection is not.
 */
function readInitialSelection() {
  try {
    const raw = localStorage.getItem('tcs:view-state:ladder:selectedByDir');
    if (raw) {
      const stored = JSON.parse(raw);
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        const isMigrated = !stored.seeded || typeof stored.seeded !== 'object';
        return {
          all: [], long: [], short: [],
          ...stored,
          // Pre-`seeded` store → deliberately empty so each direction seeds to all.
          seeded: isMigrated ? {} : { ...stored.seeded },
        };
      }
    }
  } catch { /* fall through to the legacy shape */ }

  // Pre-direction build: one flat array, which was the BOTH view. Its contents carry
  // forward as the BOTH selection, and BOTH is marked seeded so those ids are honoured.
  const legacy = readLegacySelectedIds();
  return { all: legacy, long: [], short: [], seeded: { all: legacy.length > 0 } };
}

/**
 * buildCardRef() — MOVED to src/core/score-card-view.js (2026-09-17) so the
 * META.Stack Cockpit can produce the same reference from the same code.
 * LadderPage passes its own label so the pasted text is unchanged.
 */

export default function LadderPage() {
  const cardsColRef = useRef(null); // scroll-reveal scope (issue #672)
  const { protocols, runs, isLoading } = useProtocolData();
  const { statusMap } = useProtocolStatuses();
  // Filter / sort selections persist across navigation. Protocol selections are
  // stored PER direction, so toggling BOTH/LONG/SHORT restores each view's own
  // chosen protocols instead of wiping them. See `readInitialSelection` for why the
  // `seeded` marker is part of this shape.
  const [selectedByDir, setSelectedByDir] = usePersistentState(
    'ladder:selectedByDir',
    readInitialSelection(),
  );
  const [ageFilter, setAgeFilter] = usePersistentChoice('ladder:ageFilter', 'all', ['all', ...AGE_OPTIONS]);
  const [rankBy, setRankBy] = usePersistentChoice('ladder:rankBy', 'signal', ['signal', 'opp']);

  // Free-text search across symbol, protocol, state and signal. Persisted so a
  // filtered view survives navigation — same convention as the other controls.
  const [search, setSearch] = usePersistentState('ladder:search', '');

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

  // Screen Options: how to render each card's score (raw | percent | both) — shared hook.
  const scoreDisplay = useScoreDisplay();

  // ── Copy-to-investigate — shared hook. Per-card feedback; a blocked clipboard
  // reports FAILURE rather than silently claiming success (see useCardCopy). ──
  const { copyState, copyCardRef } = useCardCopy({ label: 'TCS ladder card' });

  // Issue #667/#668 — opt-in "Details": company/stock facts + our own trading
  // stats on each card. DEFAULT OFF so the production ladder is unchanged
  // (phase-6 scope; surfaced behind a toggle). Reads are single STORED GETs,
  // Company facts + open-position stats are ALWAYS shown now, on the card footer
  // (the old "Details" toolbar toggle was removed). The queries below are enabled
  // ⚠️ Position/company lookups MOVED to src/hooks/useSymbolLookups.js (2026-09-17) so the
  // META.Stack Cockpit's Scores column renders the same "Details" footer column from the
  // same indexing. Both queries are shared by key, so visiting both pages costs one request.
  const { positionBySymbol, symbolMeta } = useSymbolLookups();

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

  // ── Seed (once) or prune the CURRENT direction's selection. ──
  //
  // ⚠️ THE ORDER OF THESE GUARDS *IS* THE FIX — do not reorder or "simplify" them.
  //
  //   1. `isLoading` — the protocol list has not arrived, so EVERY stored id looks
  //      inapplicable. Pruning here persists an empty selection: this guard was missing
  //      and it is why a 4-protocol selection collapsed to 1 on every refresh.
  //   2. `applicableProtocols.length === 0` — after loading this can still be legitimately
  //      empty (e.g. no protocol applies to SHORT). There is then nothing to prune AGAINST
  //      and nothing to seed FROM, so return rather than writing `[]`.
  //   3. Only past both guards: seed on first sight, otherwise prune.
  //
  // Seeding selects ALL applicable protocols — the reported expectation. It happens once
  // per direction (tracked by `seeded`), so a user who deliberately clears the list keeps
  // it cleared.
  //
  // Other directions' buckets are never touched, so BOTH → LONG → BOTH restores each
  // view's own selection.
  useEffect(() => {
    if (isLoading) return;
    if (applicableProtocols.length === 0) return;

    const applicableIds = applicableProtocols.map((p) => p.id);
    const applicableIdSet = new Set(applicableIds);
    const alreadySeeded = selectedByDir.seeded?.[direction] === true;

    if (!alreadySeeded) {
      setSelectedByDir((prev) => ({
        ...prev,
        [direction]: applicableIds,
        seeded: { ...(prev.seeded || {}), [direction]: true },
      }));
      return;
    }

    const cur = selectedByDir[direction] || [];
    const kept = cur.filter((id) => applicableIdSet.has(id));
    if (kept.length !== cur.length) {
      setSelectedByDir((prev) => ({ ...prev, [direction]: kept }));
    }
  }, [direction, applicableProtocols, selectedByDir, setSelectedByDir, isLoading]);

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
  // ⚠️ The score maps and the card-entry construction MOVED to
  // src/core/score-card-entries.js (2026-09-17) so the META.Stack Cockpit builds its
  // Scores column from the SAME code. Only the filtering and sorting below are
  // page-specific — the Ladder's age/market/search rules are its own.

  // Partition the selected protocols' cards into those passing all filters and
  // those excluded by them. Excluded cards are still shown below a divider so
  // the user can see which protocols/cards aren't making the ladder.
  const { passing, excluded } = useMemo(() => {
    const all = buildScoreEntries(selectedProtocols, runs);

    // Market status filter — default (Open) hides closed-market symbols so the
    // ladder shows only cards backed by an open market.
    const marketList = marketFilter === 'all' ? all : all.filter((e) => marketMatches(e, marketFilter));

    // Search filter — applied after the market filter so it narrows whatever is
    // currently visible. A search term is treated as a HARD filter (like market),
    // not a soft one: matches stay in `passing` and non-matches go nowhere, since
    // listing everything the user just excluded would defeat the point.
    const list = search.trim() ? marketList.filter((e) => matchesSearch(e, search)) : marketList;

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
  }, [selectedProtocols, runs, ageFilter, rankBy, marketFilter, search]);

  const scoredCount = passing.filter((e) => e.hasScore).length;

  // Reveal-on-scroll (issue #672). Behaviour now lives in the SHARED hook so the
  // META.Stack Cockpit gets it by calling the same function instead of either
  // copying the observer or (far worse) reusing `.lad-reveal` without it and
  // rendering invisible cards. See src/hooks/useScrollReveal.js for the safety
  // invariants (already-in-viewport reveal, IO-unavailable fallback).
  useScrollReveal(cardsColRef, [passing, excluded]);

  // One card renderer — used for both the ladder and the excluded section.
  // The card itself is the SHARED `ScoreCard` (src/components/ScoreCard.jsx),
  // also mounted by the META.Stack Cockpit's Scores column. Everything the card
  // needs is resolved HERE, at page level: the per-symbol lookups reuse the
  // page's existing memoised maps, so N cards add N×0 network calls.
  //
  // ⚠️ `copied` is `null` unless THIS card is the one whose copy just resolved —
  // the feedback is per-card, not global.
  const renderCard = (e, i, dimmed) => (
    <ScoreCard
      key={`${e.protocolId}::${e.symbol}`}
      entry={e}
      rank={i}
      dimmed={dimmed}
      scoreDisplay={scoreDisplay}
      rankBy={rankBy}
      meta={symbolMeta[String(e.symbol).toUpperCase()] || null}
      pos={positionBySymbol[String(e.symbol).toUpperCase()] || null}
      onCopyRef={copyCardRef}
      copied={copyState.key === `${e.protocolId}::${e.symbol}` ? copyState.ok : null}
    />
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
        <LadderToolbar
          rankBy={rankBy} onRankBy={setRankBy}
          ageFilter={ageFilter} onAgeFilter={setAgeFilter}
          marketFilter={marketFilter} onMarketFilter={setMarketFilter}
          search={search} onSearch={setSearch}
          searchAriaLabel="Search ladder by symbol, protocol, state or signal"
        >
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
        </LadderToolbar>

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
            <LadderEmptyState
              search={search}
              onClearSearch={() => setSearch('')}
              marketFilter={marketFilter}
            />
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
                  <LadderExcludedDivider count={excluded.length} />
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
