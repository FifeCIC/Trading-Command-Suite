/**
 * A/B Ladder — the pair-aware ladder (Scoring area).
 * ====================================================
 * A clone of the Ladder's presentation scoped to an A/B PAIR: pick two protocols,
 * and every symbol either protocol scores is ranked as usual — with a comparison
 * strip beside each card that says which side is scoring higher.
 *
 * WHAT IS COPIED FROM THE LADDER, DELIBERATELY
 *   - `useProtocolData()` — the SAME two endpoints (gated/protocols + runs), so the
 *     pair join costs no new data path and cannot drift from the ladder's numbers.
 *   - `buildScoreEntries()` — the shared card-entry builder. Called once per side,
 *     then joined by symbol. No second lookup implementation.
 *   - `ScoreCard` — the one score-card presentation, unchanged. The strip is a
 *     SIBLING of the card, not a modification, so the cockpit's card is untouched.
 *   - `ladder.css` — imported rather than forked: the ladder's layout, card and
 *     state-chip styles are the identity of this view. Only the strip and the
 *     single-column layout delta live in `ab-ladder.css`. A full CSS copy is the
 *     "second implementation" this repo has already paid for (thresholds, freshness,
 *     comment parsing) — the visual identity comes from the same file.
 *
 * WHAT IS REMOVED FROM THE LADDER
 *   - `aside.lad-proto-col` — the pair pickers replace it; the pair IS the scope.
 *   - the direction view (BOTH/LONG/SHORT) — a pair comparison is direction-agnostic;
 *     each protocol's own applicability is unchanged by being compared.
 *
 * ⚠️ TWO DECISIONS MADE EXPLICIT (they define what the ladder MEANS)
 *   1. ORDERING — ranked by the PAIR MAXIMUM: a row's rank value is the higher of the
 *      two sides' scores (Signal or Opportunity, per the Score by control). The
 *      alternative (rank by A, or by B) quietly favours one side; "as usual" has no
 *      single meaning once two scores exist, so it is declared here and shown in the
 *      legend. Ties and one-sided rows fall through to the one score that exists.
 *   2. SYMBOL SET — the UNION of both sides' resolved symbols. Intersection would be
 *      cleaner but hides coverage differences; a one-sided row (only A or only B has
 *      a score) is itself a finding about the pair, so it renders with the empty side
 *      stated as "no score" rather than being dropped.
 *
 * ⚠️ CONFIG-LEVEL PAIRS ARE NOT VISIBLE HERE YET.
 * This view compares PROTOCOLS. A running `ab_test` whose sides differ only in config
 * (e.g. the live weightStrategy test — same protocol, different variant) cannot be
 * shown by any scores view: `POST /api/scoring/gated/batch` accepts only
 * `{tickers, protocolId}` and `/api/scoring/runs` records protocol scores, not config
 * scores. The day a scoring endpoint accepts a snapshot/config, the strip lights up
 * for those pairs too; until then it is honest about comparing protocols.
 *
 * ⚠️ NO AnimatePresence EXITS HERE. The Screener exit-freeze (2026-08-xx) showed
 * motion 12.40 exit callbacks can never fire under constant refetch — a frozen clone
 * sitting invisible over the page. Cards animate IN (ScoreCard owns that) and the
 * stack re-lays-out via `layout`; nothing animates OUT, so the failure cannot occur.
 *
 * @uses useProtocolData()  (src/core/useProtocolData.js) — same data as the Ladder
 * @uses buildScoreEntries() (src/core/score-card-entries.js)
 * @uses ScoreCard (src/components/ScoreCard.jsx)
 */
import { useEffect, useMemo, useRef } from 'react';
import { motion } from 'motion/react';
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
import './ab-ladder.css';

/**
 * Side identifiers — SHAPE first, colour second.
 * ⚠️ Shape + letter + written label, never colour alone: the lead is also stated in
 * words by the delta chip ("B +27"), so the comparison survives colour-blind rendering
 * and greyscale printing. `aria-hidden` on the glyph because the letter beside it
 * carries the same information for screen readers.
 */
const SIDE_GLYPH = { a: '⬤', b: '◆' };

/**
 * buildPairRow(aEntry, bEntry, rankBy) — join one symbol's two sides into a row.
 *
 * `lead` is the side with the higher rank value ('a' | 'b' | null on a tie);
 * `delta` is the percentage-point gap when BOTH sides carry a percentage, else null —
 * a gap computed against a missing denominator would be a fabricated number.
 */
function buildPairRow(symbol, aEntry, bEntry, rankBy) {
  const key = rankBy === 'opp' ? 'opportunityPct' : 'pct';
  const val = (e) => (e?.hasScore ? (e.vm?.[key] ?? null) : null);
  const va = val(aEntry);
  const vb = val(bEntry);

  let lead = null;
  let delta = null;
  if (va != null && vb != null) {
    if (va > vb) lead = 'a';
    else if (vb > va) lead = 'b';
    delta = Math.round(Math.abs(va - vb));
  } else if (va != null) lead = 'a';
  else if (vb != null) lead = 'b';

  const primary = lead === 'b' && bEntry ? bEntry : (aEntry || bEntry);
  const other = primary === aEntry ? bEntry : aEntry;
  const highest = Math.max(va ?? -1, vb ?? -1);

  return {
    symbol,
    a: aEntry,
    b: bEntry,
    lead,
    delta,
    primary,
    other,
    highest,
    hasScore: !!(aEntry?.hasScore || bEntry?.hasScore),
    primaryFrozen: !!primary?.vm?.frozen,
    // One vm for the page-level filters. The symbol's market is the same question on
    // either side; the scored side answers it.
    // `marketMatches()` reads `entry.vm` — rows on the Ladder ARE entries, but a
    // PAIR row wraps two entries, so it must expose the market VM under the same
    // field name for the shared filter to see it. Named `vm` (not `filterVm`) for
    // exactly that reason: the first version used `filterVm` and every row was
    // silently excluded by the Market filter, because `entry.vm` was undefined
    // (observed live 2026-09-22 — "No open-market symbols for this pair" while
    // XAUUSD was scored 145/66 with market open).
    vm: (aEntry?.hasScore ? aEntry.vm : null) || (bEntry?.hasScore ? bEntry.vm : null) || aEntry?.vm || bEntry?.vm || null,
    time: aEntry?.time && bEntry?.time
      ? (Date.parse(aEntry.time) >= Date.parse(bEntry.time) ? aEntry.time : bEntry.time)
      : (aEntry?.time || bEntry?.time || null),
  };
}

/** One side of the comparison strip. */
function SideBlock({ side, entry, winning, name }) {
  const has = !!entry?.hasScore;
  const vm = entry?.vm || {};
  const pct = has ? vm.pct : null;
  const raw = has && vm.score != null
    ? `${vm.score}${vm.scoreMax ? ` / ${vm.scoreMax}` : ''}`
    : null;
  const signal = has ? (vm.signal ?? '—') : null;

  const detail = has
    ? `Side ${side.toUpperCase()} — ${name}: ${signal ?? 'no signal'}, ${raw ?? 'no score'}`
      + `${pct != null ? ` (${pct}%)` : ''}`
    : `Side ${side.toUpperCase()} — ${name}: no score yet`;

  return (
    <div
      className={`ab-side ab-side--${side}${winning ? ' ab-side--lead' : ''}${has ? '' : ' ab-side--none'}`}
      title={detail}
    >
      <span className="ab-side-id">
        <span className="ab-side-glyph" aria-hidden="true">{SIDE_GLYPH[side]}</span>
        {side.toUpperCase()}
      </span>
      <span className="ab-side-score">{pct != null ? `${pct}%` : '—'}</span>
      <span className="ab-side-signal">{has ? (signal ?? '—') : 'no score'}</span>
    </div>
  );
}

export default function AbLadderPage() {
  const cardsColRef = useRef(null); // scroll-reveal scope — cards stay invisible without it
  const { protocols, runs, isLoading } = useProtocolData();
  const { statusMap } = useProtocolStatuses();
  const { positionBySymbol, symbolMeta } = useSymbolLookups();

  // The pair. Persisted so the view survives navigation; `seeded` marks the one-time
  // default (first two scoreable protocols) so a deliberate choice is never overwritten —
  // the same guard shape the Ladder's protocol selection needed (see LadderPage).
  const [pair, setPair] = usePersistentState('abladder:pair', { a: null, b: null, seeded: false });

  const [ageFilter, setAgeFilter] = usePersistentChoice('abladder:ageFilter', 'all', ['all', ...AGE_OPTIONS]);
  const [rankBy, setRankBy] = usePersistentChoice('abladder:rankBy', 'signal', ['signal', 'opp']);
  const [marketFilter, setMarketFilter] = usePersistentChoice('abladder:market', 'open', ['open', 'all', 'closed']);
  const [search, setSearch] = usePersistentState('abladder:search', '');

  const scoreDisplay = useScoreDisplay();
  const { copyState, copyCardRef } = useCardCopy({ label: 'TCS A/B ladder card' });

  // Protocols that can actually score — same filter the Ladder applies before offering
  // a protocol for selection (no-data and paused produce empty cards).
  const selectableProtocols = useMemo(
    () => protocols
      .filter((p) => p.active !== false)
      .filter((p) => {
        const st = statusMap[p.id]?.state;
        return st !== 'no-data' && st !== 'paused';
      }),
    [protocols, statusMap],
  );

  // Seed once / heal stored ids that no longer exist. No effect when the pair is valid.
  useEffect(() => {
    if (isLoading || selectableProtocols.length === 0) return;
    const ids = new Set(selectableProtocols.map((p) => p.id));
    let a = ids.has(pair.a) ? pair.a : null;
    let b = ids.has(pair.b) ? pair.b : null;
    let seeded = pair.seeded;
    if (!seeded) {
      a = a ?? selectableProtocols[0].id;
      b = b ?? (selectableProtocols.find((p) => p.id !== a)?.id ?? null);
      seeded = true;
    }
    if (a && a === b) b = selectableProtocols.find((p) => p.id !== a)?.id ?? null;
    if (a !== pair.a || b !== pair.b || seeded !== pair.seeded) {
      setPair({ a, b, seeded });
    }
  }, [isLoading, selectableProtocols, pair, setPair]);

  const protoA = useMemo(() => selectableProtocols.find((p) => p.id === pair.a) || null, [selectableProtocols, pair.a]);
  const protoB = useMemo(() => selectableProtocols.find((p) => p.id === pair.b) || null, [selectableProtocols, pair.b]);

  const picker = (which) => (
    <select
      value={pair[which] || ''}
      onChange={(e) => setPair((prev) => ({ ...prev, [which]: e.target.value, seeded: true }))}
      aria-label={`Protocol ${which.toUpperCase()} of the pair`}
    >
      <option value="">— none —</option>
      {selectableProtocols.map((p) => (
        <option key={p.id} value={p.id}>{p.name ?? p.id}</option>
      ))}
    </select>
  );

  const swapPair = () => setPair((prev) => ({ ...prev, a: prev.b, b: prev.a, seeded: true }));

  // ── Join both sides by symbol, then filter and rank ──
  const { passing, excluded, bothScored } = useMemo(() => {
    if (!protoA || !protoB) return { passing: [], excluded: [], bothScored: 0 };

    const aEntries = buildScoreEntries([protoA], runs);
    const bEntries = buildScoreEntries([protoB], runs);

    const bySymbol = new Map();
    for (const e of aEntries) bySymbol.set(e.symbol, { a: e, b: null });
    for (const e of bEntries) {
      const row = bySymbol.get(e.symbol) || { a: null, b: null };
      row.b = e;
      bySymbol.set(e.symbol, row);
    }

    const all = [...bySymbol.entries()]
      .map(([symbol, sides]) => buildPairRow(symbol, sides.a, sides.b, rankBy));
    const both = all.filter((r) => r.a?.hasScore && r.b?.hasScore).length;

    const marketList = marketFilter === 'all' ? all : all.filter((r) => marketMatches(r, marketFilter));
    const list = search.trim()
      ? marketList.filter((r) => (r.a && matchesSearch(r.a, search)) || (r.b && matchesSearch(r.b, search)))
      : marketList;

    const sorter = (x, y) => {
      // Actionable first (a live reading beats a frozen one), then pair-max score —
      // see the header: the ordering basis is the HIGHER of the two sides.
      const tx = x.hasScore && !x.primaryFrozen ? 1 : 0;
      const ty = y.hasScore && !y.primaryFrozen ? 1 : 0;
      if (tx !== ty) return ty - tx;
      if (x.hasScore !== y.hasScore) return x.hasScore ? -1 : 1;
      return y.highest - x.highest;
    };

    if (ageFilter === 'all') {
      list.sort(sorter);
      return { passing: list, excluded: [], bothScored: both };
    }
    const cutoff = Date.now() - Number(ageFilter) * 60_000;
    const pass = list.filter((r) => r.time && new Date(r.time).getTime() >= cutoff);
    const excl = list.filter((r) => !(r.time && new Date(r.time).getTime() >= cutoff));
    pass.sort(sorter);
    excl.sort(sorter);
    return { passing: pass, excluded: excl, bothScored: both };
  }, [protoA, protoB, runs, rankBy, marketFilter, search, ageFilter]);

  useScrollReveal(cardsColRef, [passing, excluded]);

  const scoredCount = passing.filter((r) => r.hasScore).length;

  const renderRow = (row, i, dimmed) => {
    const cardEntry = row.primary;
    if (!cardEntry) return null;
    const cardKey = `${cardEntry.protocolId}::${cardEntry.symbol}`;
    return (
      <div key={row.symbol} className="ab-pair-row">
        <ScoreCard
          entry={cardEntry}
          rank={i}
          dimmed={dimmed}
          scoreDisplay={scoreDisplay}
          rankBy={rankBy}
          meta={symbolMeta[String(row.symbol).toUpperCase()] || null}
          pos={positionBySymbol[String(row.symbol).toUpperCase()] || null}
          onCopyRef={copyCardRef}
          copied={copyState.key === cardKey ? copyState.ok : null}
        />
        {/* The comparison strip — the reason this page exists. A SIBLING of the
            shared card, so nothing here can alter the Ladder's or the cockpit's card. */}
        <div
          className="ab-strip"
          role="group"
          aria-label={`A/B comparison for ${row.symbol}`}
        >
          {/* Reveal with the card: an unrevealed `.lad-reveal` is opacity 0, and the
              scroll hook grants visibility to every one inside the container. */}
          <div className="lad-reveal">
            <SideBlock side="a" entry={row.a} winning={row.lead === 'a'} name={protoA?.name ?? pair.a} />
            <SideBlock side="b" entry={row.b} winning={row.lead === 'b'} name={protoB?.name ?? pair.b} />
            {row.delta != null && row.lead && (
              <span
                className="ab-delta"
                title={
                  `Signal-score gap: ${row.lead.toUpperCase()} leads by ${row.delta} percentage point` +
                  `${row.delta === 1 ? '' : 's'} (of each protocol's own capacity)`
                }
              >
                {row.lead.toUpperCase()} +{row.delta}
              </span>
            )}
            {row.delta == null && !(row.a?.hasScore && row.b?.hasScore) && (
              <span className="ab-delta ab-delta--na" title="Only one side has scored this symbol — a gap needs both denominators">
                Δ n/a
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="lad-page">
        <header className="lad-header"><h1>A/B Ladder</h1></header>
        <LoadingSkeleton variant="card" count={4} />
      </div>
    );
  }

  return (
    <div className="lad-page">
      <header className="lad-header">
        <div>
          <h1>A/B Ladder
            <PageInfoPopover>
              The Ladder, scoped to a protocol PAIR. Pick protocol A and protocol B, and every
              symbol either side resolves is ranked as on the Ladder — with a strip beside each
              card showing both sides&apos; scores ({SIDE_GLYPH.a} A / {SIDE_GLYPH.b} B) and which
              is higher. Rows are ranked by the PAIR MAXIMUM (the higher of the two sides), and
              the symbol set is the UNION of both sides — one-sided rows are shown, not hidden.
              A running A/B test that changes only CONFIG (not protocol) cannot be shown here yet:
              scoring is protocol-scoped, so those pairs render identical sides by design.
            </PageInfoPopover>
          </h1>
          <p className="lad-subtitle">
            {passing.length} symbol{passing.length === 1 ? '' : 's'} in ladder · {scoredCount} scored ·
            {' '}{bothScored} scored by both sides
            {excluded.length > 0 ? ` · ${excluded.length} filtered` : ''}
          </p>
        </div>
      </header>

      <div className="ab-layout">
        <LadderToolbar
          rankBy={rankBy} onRankBy={setRankBy}
          ageFilter={ageFilter} onAgeFilter={setAgeFilter}
          marketFilter={marketFilter} onMarketFilter={setMarketFilter}
          search={search} onSearch={setSearch}
          searchAriaLabel="Search the A/B ladder by symbol, protocol, state or signal"
        >
          <label className="lad-filter ab-pair-pick">
            <span className="ab-pair-glyph" aria-hidden="true">{SIDE_GLYPH.a}</span>
            A:
            {picker('a')}
          </label>
          <button type="button" className="ab-swap-btn" onClick={swapPair} title="Swap sides A and B" aria-label="Swap sides A and B">
            ⇄
          </button>
          <label className="lad-filter ab-pair-pick">
            <span className="ab-pair-glyph" aria-hidden="true">{SIDE_GLYPH.b}</span>
            B:
            {picker('b')}
          </label>
        </LadderToolbar>

        {protoA && protoB && (
          <p className="ab-legend">
            <span className="ab-side-glyph" aria-hidden="true">{SIDE_GLYPH.a}</span> A = {protoA.name ?? protoA.id}
            {' · '}
            <span className="ab-side-glyph" aria-hidden="true">{SIDE_GLYPH.b}</span> B = {protoB.name ?? protoB.id}
            {' · '}ranked by the higher of the two sides
            {rankBy === 'opp' ? ' (Opportunity)' : ' (Signal)'}
          </p>
        )}

        <main className="lad-cards-col" ref={cardsColRef}>
          {!protoA || !protoB ? (
            <div className="lad-empty">
              <p className="lad-empty-title">Pick two protocols to compare.</p>
              <p>Side A and side B above — every symbol either side scores becomes a ranked row with a comparison strip.</p>
            </div>
          ) : passing.length === 0 && excluded.length === 0 ? (
            <LadderEmptyState
              search={search}
              onClearSearch={() => setSearch('')}
              marketFilter={marketFilter}
              subject="pair"
            />
          ) : (
            <>
              {passing.length > 0 && (
                <motion.div layout className="lad-stack">
                  {passing.map((row, i) => renderRow(row, i, false))}
                </motion.div>
              )}
              {excluded.length > 0 && (
                <>
                  <LadderExcludedDivider count={excluded.length} noun="row" />
                  <motion.div layout className="lad-stack">
                    {excluded.map((row, i) => renderRow(row, i, true))}
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
