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
 *   - `aside.lad-proto-col` — the pair IS the scope.
 *   - the direction view (BOTH/LONG/SHORT) — a pair comparison is direction-agnostic;
 *     each protocol's own applicability is unchanged by being compared.
 *
 * ⚠️ THE PAIR IS NOT CHOSEN ON THIS PAGE (2026-09-22, owner's call: the pair pickers
 * "are strictly for the comparison of two selections" and read as clutter). The pair
 * now comes from, in order: `?pair=<protocolId>,<protocolId>` in the URL — the
 * integration point for the future A/B pairing config (anything that knows a pair
 * links straight here, and invalid ids are ignored so a stale link cannot blank the
 * view) — else the persisted `abladder:pair`, else a one-time seed of the first two
 * scoreable protocols so the page is never blank. The page header states which pair is
 * being compared: that is identity, not a control.
 *
 * ⚠️ EVERY CARD IS ONE SIDE — THE PAIR IS A SCOPE, NOT A RANKING UNIT (2026-09-22,
 * owner's flaw report). The first version joined both sides into ONE row per symbol
 * ranked by the PAIR MAXIMUM. Measured result: a row whose CARD (side A) read "HOLD 4%"
 * sat at #1 because the STRIP side had scored 8% — the rank described something the
 * card did not show, and the better side had no card of its own ("B should be at the
 * top of the ladder but there is no other BTC. So it's as if it's designed to not
 * allow the same symbol to appear"). Now A-cards AND B-cards both rank in the ladder —
 * each card stands at ITS OWN score, exactly as on the Ladder — and the strip beside a
 * card answers one question: "what did the OTHER side do on this symbol?". A symbol
 * both sides score appears TWICE (one card per side); that is the point, not an
 * accident.
 *
 * ⚠️ THE STRIP CARRIES IDENTITY, NOT JUST NUMBERS (owner — "include more data as a way
 * of validating and building trust over what we're looking at"). It states the SYMBOL
 * (a link, like the card's), the protocol name and the RAW scores beside their
 * percentages, so the strip can be checked without trusting the card's framing; the row
 * title also carries the scored age. The gap states who leads — "B +4", "±0" tie,
 * "Δ n/a" one side only. Side letter boxes are ONE treatment with ONE colour per side
 * (A = --accent, B = --color-accent-blue), on card and strip alike; the letter is
 * always text, so colour is never the sole differentiator (ui-standards).
 * Card head layout (same review): side-letter box top-right, state chip centred, copy
 * chip bottom-right.
 *
 * ⚠️ SYMBOL SET — the UNION of both sides' resolved symbols. Intersection would hide
 * coverage differences: a one-sided symbol (only A, or only B, resolves it) is itself a
 * finding about the pair, so it renders with the empty side stated as "no score" rather
 * than being dropped.
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
import { Link, useSearchParams } from 'react-router-dom';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import ScoreCard from '../components/ScoreCard';
import { LadderToolbar, LadderEmptyState, LadderExcludedDivider } from '../components/LadderPanels';
import { matchesSearch } from '../core/score-card-view';
import { timeAgo } from '../core/format-utils';
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
 * Side letters — the ONLY side identity (the ⬤/◆ glyphs were dropped 2026-09-22: the
 * card wears one letter and the strip the other, so a shape marker was printing the
 * same fact twice). Each SIDE owns a colour (A = --accent, B = --color-accent-blue),
 * applied wherever that side appears; the letter is text above all, and the gap is
 * stated in words ("B +27" / "±0" / "Δ n/a"), so the comparison survives colour-blind
 * rendering and greyscale printing.
 */

/**
 * buildSideRow(symbol, side, entry, otherSide, otherEntry, rankBy) — ONE ladder row:
 * one side's card (ranked by ITS OWN score, exactly as on the Ladder) plus the other
 * side's data for the same symbol as the comparison strip. A symbol both sides score
 * produces TWO rows — see the header before changing this.
 *
 * `lead` is the side with the higher rank value ('a' | 'b' | null on a tie);
 * `delta` is the percentage-point gap when BOTH sides carry a percentage, else null —
 * a gap computed against a missing denominator would be a fabricated number.
 */
function buildSideRow(symbol, side, entry, otherSide, otherEntry, rankBy) {
  const key = rankBy === 'opp' ? 'opportunityPct' : 'pct';
  const val = (e) => (e?.hasScore ? (e.vm?.[key] ?? null) : null);
  const mine = val(entry);
  const theirs = val(otherEntry);

  let lead = null;
  let delta = null;
  if (mine != null && theirs != null) {
    if (mine > theirs) lead = side;
    else if (theirs > mine) lead = otherSide;
    delta = Math.round(Math.abs(mine - theirs));
  } else if (mine != null) lead = side;
  else if (theirs != null) lead = otherSide;

  return {
    symbol,
    side,
    otherSide,
    entry,
    other: otherEntry,
    score: mine ?? -1,
    lead,
    delta,
    // A real tie (both sides scored, same value) is stated as ±0 rather than rendering
    // nothing — an invisible gap reads as "no data", which is a different fact.
    tie: mine != null && theirs != null && mine === theirs,
    hasScore: !!entry?.hasScore,
    frozen: !!entry?.vm?.frozen,
    // `marketMatches()` reads `entry.vm` — a row must expose the market VM under the
    // same field name for the shared filter to see it. Named `vm` (not `filterVm`) for
    // exactly that reason: the first version used `filterVm` and every row was
    // silently excluded by the Market filter, because `entry.vm` was undefined
    // (observed live 2026-09-22). The row's OWN entry answers it; the other side is
    // only a fallback when the card has no vm at all.
    vm: entry?.vm || otherEntry?.vm || null,
    // The age filter follows the CARD's score — a row is filtered on what it shows.
    time: entry?.time || otherEntry?.time || null,
  };
}

/**
 * StripSide({ side, entry, name, rankBy, symbol }) — the compact half of the comparison:
 * the OTHER side of the row (whichever side the card is not).
 * Carries IDENTITY as well as numbers — the boxed side letter, the symbol (a link, like
 * the card's), the signal word and protocol name, and BOTH scores as raw beside their
 * percentage (so the percentage can be recomputed, not trusted), with the metric picked
 * by "Score by" highlighted exactly like the card's blocks. The row title carries the
 * scored age. An unscored side states "no score" rather than rendering zeroes — a zero
 * is a real score and must not be confusable with an absent one.
 */
function StripSide({ side, entry, name, rankBy, symbol }) {
  const has = !!entry?.hasScore;
  const vm = entry?.vm || {};
  const signalPct = has ? (vm.pct ?? null) : null;
  const oppPct = has ? (vm.opportunityPct ?? null) : null;
  const signalRaw = has && vm.score != null
    ? `${vm.score.toLocaleString()}${vm.scoreMax ? ` / ${vm.scoreMax.toLocaleString()}` : ''}`
    : null;
  const oppRaw = has && vm.opportunityScore != null
    ? `${vm.opportunityScore.toLocaleString()}${vm.opportunityMax ? ` / ${vm.opportunityMax.toLocaleString()}` : ''}`
    : null;
  const signalWord = has ? (vm.signal ?? null) : null;

  const detail = has
    ? `${symbol} · Side ${side.toUpperCase()} — ${name}: ${signalWord ?? 'no signal'}, Signal ${signalRaw ?? '—'}${signalPct != null ? ` (${signalPct}%)` : ''}, Opp ${oppRaw ?? '—'}${oppPct != null ? ` (${oppPct}%)` : ''}`
      + (entry?.time ? ` · scored ${timeAgo(entry.time)}` : '')
    : `${symbol} · Side ${side.toUpperCase()} — ${name}: no score yet`;

  return (
    <div className={`ab-side ab-side--${side}${has ? '' : ' ab-side--none'}`} title={detail}>
      <span className="ab-side-head">
        <span className={`ab-strip-letter ab-sideletter ab-sideletter--${side}`} aria-hidden="true">
          {side.toUpperCase()}
        </span>
        <Link
          className="ab-strip-symbol"
          to={`/research/symbol/${encodeURIComponent(symbol)}`}
          title={`Open ${symbol}`}
        >
          {symbol}
        </Link>
      </span>
      <span className="ab-side-name">
        {has ? `${signalWord ?? '—'} · ${name}` : `no score · ${name}`}
      </span>
      <span className="ab-strip-scores">
        <span className={`ab-strip-score${rankBy === 'signal' ? ' ab-strip-score--active' : ''}`}>
          <span className="ab-strip-score-label">Signal</span>
          <span className="ab-strip-score-raw">{signalRaw ?? ''}</span>
          <span className="ab-strip-score-value">{signalPct != null ? `${signalPct}%` : '—'}</span>
        </span>
        <span className={`ab-strip-score${rankBy === 'opp' ? ' ab-strip-score--active' : ''}`}>
          <span className="ab-strip-score-label">Opp</span>
          <span className="ab-strip-score-raw">{oppRaw ?? ''}</span>
          <span className="ab-strip-score-value">{oppPct != null ? `${oppPct}%` : '—'}</span>
        </span>
      </span>
    </div>
  );
}

export default function AbLadderPage() {
  const cardsColRef = useRef(null); // scroll-reveal scope — cards stay invisible without it
  const { protocols, runs, isLoading } = useProtocolData();
  const { statusMap } = useProtocolStatuses();
  const { positionBySymbol, symbolMeta } = useSymbolLookups();

  // The pair. Persisted so the view survives navigation; `seeded` marks the one-time
  // default (first two scoreable protocols) so a deliberate choice — or a `?pair=` link —
  // is never overwritten by the seed. The same guard shape the Ladder's protocol
  // selection needed (see LadderPage).
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

  // The pair can also arrive in the URL — `?pair=<id>,<id>`. This is the integration
  // point for the future A/B pairing config: anything that knows a pair (a pairing
  // table, an issue, a bookmark) links straight to it, and this page needs no picker
  // of its own (removed 2026-09-22). Invalid or unknown ids are ignored in silence on
  // purpose — a stale link must not blank the view; the persisted pair stands.
  const [searchParams] = useSearchParams();
  const pairParam = searchParams.get('pair') || '';
  useEffect(() => {
    if (!pairParam || selectableProtocols.length === 0) return;
    const [a, b] = pairParam.split(',').map((s) => s.trim());
    if (!a || !b || a === b) return;
    const ids = new Set(selectableProtocols.map((p) => p.id));
    if (!ids.has(a) || !ids.has(b)) return;
    if (pair.a === a && pair.b === b) return;
    setPair({ a, b, seeded: true });
  }, [pairParam, selectableProtocols, pair.a, pair.b, setPair]);

  const protoA = useMemo(() => selectableProtocols.find((p) => p.id === pair.a) || null, [selectableProtocols, pair.a]);
  const protoB = useMemo(() => selectableProtocols.find((p) => p.id === pair.b) || null, [selectableProtocols, pair.b]);

  // ── Build one row per SIDE (A-cards and B-cards both), then filter and rank ──
  const { passing, excluded, bothScored, symbolCount } = useMemo(() => {
    if (!protoA || !protoB) return { passing: [], excluded: [], bothScored: 0, symbolCount: 0 };

    const aEntries = buildScoreEntries([protoA], runs);
    const bEntries = buildScoreEntries([protoB], runs);

    // The other side's entry for the same symbol — the comparison half of each row.
    const aBySymbol = new Map(aEntries.map((e) => [e.symbol, e]));
    const bBySymbol = new Map(bEntries.map((e) => [e.symbol, e]));

    const all = [
      ...aEntries.map((e) => buildSideRow(e.symbol, 'a', e, 'b', bBySymbol.get(e.symbol), rankBy)),
      ...bEntries.map((e) => buildSideRow(e.symbol, 'b', e, 'a', aBySymbol.get(e.symbol), rankBy)),
    ];
    // "Scored by both sides" is counted per SYMBOL (not per row): it is one fact about
    // the pair however many cards the symbol produces.
    const both = aEntries.filter((e) => e.hasScore && bBySymbol.get(e.symbol)?.hasScore).length;
    const symbolCount = new Set(all.map((r) => r.symbol)).size;

    const marketList = marketFilter === 'all' ? all : all.filter((r) => marketMatches(r, marketFilter));
    const list = search.trim()
      ? marketList.filter((r) => (r.entry && matchesSearch(r.entry, search)) || (r.other && matchesSearch(r.other, search)))
      : marketList;

    const sorter = (x, y) => {
      // Actionable first (a live reading beats a frozen one), then the card's OWN score —
      // the rank must describe the card that carries it (see the header).
      const tx = x.hasScore && !x.frozen ? 1 : 0;
      const ty = y.hasScore && !y.frozen ? 1 : 0;
      if (tx !== ty) return ty - tx;
      if (x.hasScore !== y.hasScore) return x.hasScore ? -1 : 1;
      return y.score - x.score;
    };

    if (ageFilter === 'all') {
      list.sort(sorter);
      return { passing: list, excluded: [], bothScored: both, symbolCount };
    }
    const cutoff = Date.now() - Number(ageFilter) * 60_000;
    const pass = list.filter((r) => r.time && new Date(r.time).getTime() >= cutoff);
    const excl = list.filter((r) => !(r.time && new Date(r.time).getTime() >= cutoff));
    pass.sort(sorter);
    excl.sort(sorter);
    return { passing: pass, excluded: excl, bothScored: both, symbolCount };
  }, [protoA, protoB, runs, rankBy, marketFilter, search, ageFilter]);

  useScrollReveal(cardsColRef, [passing, excluded]);

  const renderRow = (row, i, dimmed) => {
    const cardEntry = row.entry;
    if (!cardEntry) return null;
    const cardKey = `${cardEntry.protocolId}::${cardEntry.symbol}`;
    const cardName = row.side === 'a' ? (protoA?.name ?? pair.a) : (protoB?.name ?? pair.b);
    const stripName = row.otherSide === 'a' ? (protoA?.name ?? pair.a) : (protoB?.name ?? pair.b);
    const leadName = row.lead === 'a' ? (protoA?.name ?? pair.a) : (protoB?.name ?? pair.b);
    return (
      // ⚠️ The key includes the PROTOCOL: a symbol both sides score has TWO rows.
      <div key={cardKey} className="ab-pair-row">
        {/* This row's side, full card, wearing its side letter — the corner badge. */}
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
          cornerBadge={
            <span
              className={`ab-corner-badge ab-sideletter ab-sideletter--${row.side}`}
              aria-hidden="true"
              title={`Card side: ${row.side.toUpperCase()} — ${cardName}`}
            >
              {row.side.toUpperCase()}
            </span>
          }
        />
        {/* The OTHER side of the pair, compact: its letter, its signal word, BOTH its
            scores, and the gap. A SIBLING of the shared card — nothing here can alter
            the Ladder's or the cockpit's card. */}
        <div
          className="ab-strip"
          role="group"
          aria-label={`A/B comparison for ${row.symbol} — card is side ${row.side.toUpperCase()}, strip is side ${row.otherSide.toUpperCase()}`}
        >
          {/* Reveal with the card: an unrevealed `.lad-reveal` is opacity 0, and the
              scroll hook grants visibility to every one inside the container. */}
          <div className="lad-reveal">
            <StripSide side={row.otherSide} entry={row.other} name={stripName} rankBy={rankBy} symbol={row.symbol} />
            {row.lead && row.delta != null && (
              <span
                className={`ab-delta ab-delta--${row.lead}`}
                title={`${leadName} leads by ${row.delta} percentage point${row.delta === 1 ? '' : 's'} (of each protocol's own capacity)`}
              >
                {row.lead.toUpperCase()} +{row.delta}
              </span>
            )}
            {!row.lead && row.tie && (
              <span className="ab-delta ab-delta--tie" title="Tie — both sides score the same on the ranked metric">
                ±0
              </span>
            )}
            {row.delta == null && !row.lead && !row.tie && (
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
              The Ladder, scoped to a protocol PAIR. Every card is ONE side&apos;s score,
              ranked by its own value exactly as on the Ladder — a symbol both sides score
              appears twice, once per side, so the better side always takes its own place at
              the top. Beside each card a strip shows what the OTHER side did on the same
              symbol: its letter, the symbol, the protocol, and its raw and percentage
              scores for Signal and Opp. The gap states who is ahead: “B +4” means B leads
              by 4 points, “±0” is a tie, “Δ n/a” means only one side scored. One-sided
              symbols are shown, not hidden. The pair comes from the URL (?pair=id,id) or
              the last-used pair; it is set by whatever owns A/B pairing, not on this page.
              A running A/B test that changes only CONFIG (not protocol) cannot be shown
              here yet: scoring is protocol-scoped, so those pairs render identical sides
              by design.
            </PageInfoPopover>
          </h1>
          <p className="lad-subtitle">
            {protoA && protoB ? `A: ${protoA.name ?? protoA.id} vs B: ${protoB.name ?? protoB.id} · ` : ''}
            {passing.length} card{passing.length === 1 ? '' : 's'}
            {' · '}{symbolCount} symbol{symbolCount === 1 ? '' : 's'}
            {' · '}{bothScored} scored by both sides
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
        />

        {/* Generic by design (owner, 2026-09-22): the legend explains the CODING —
            the pair's names belong in the header subtitle, not repeated per page. */}
        {protoA && protoB && (
          <p className="ab-legend">
            <span className="ab-legend-letter ab-legend-letter--a">A</span> and
            {' '}<span className="ab-legend-letter ab-legend-letter--b">B</span> are the two sides of the pair
            {' · '}every card is one side&apos;s score, ranked as on the Ladder
            {' · '}the strip is what the other side did on the same symbol
            {' · '}&ldquo;B +4&rdquo; means B leads by 4 points, &ldquo;±0&rdquo; a tie, &ldquo;Δ n/a&rdquo; one side only
          </p>
        )}

        <main className="lad-cards-col" ref={cardsColRef}>
          {!protoA || !protoB ? (
            <div className="lad-empty">
              <p className="lad-empty-title">No pair to show yet.</p>
              <p>
                This view compares two scoring protocols; they are chosen by whatever owns
                A/B pairing. A link such as ?pair=xau-speed-m15,xau-speed-1h selects a pair
                directly.
              </p>
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
