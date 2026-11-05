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
import NoticeBlock from '../components/NoticeBlock';
import { filterStrategies, isActiveStrategy, isTradingStrategy, isScoringStrategy, isFaultyStrategy, matchesBotSearch } from '../core/strategy-filters';
import { useSort } from '../core/use-sort';
import StrategyFaultBadge from '../components/StrategyFaultBadge';
import PageInfoPopover from '../components/PageInfoPopover';
// The scoring mechanics panel (owner request, 2026-10-08): the maths behind the Score column, shown
// on live numbers rather than described.
import ScoringMechanicsPanel from '../components/ScoringMechanicsPanel.jsx';
// #1193 — the earned level and the active-bot ceiling it decides. Mounted ABOVE the table because
// it states a constraint on activation (what the toggles below will refuse), not an explanation of
// a column.
import ProgressionPanel from '../components/ProgressionPanel.jsx';
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
 * THEORY_KIND_LABEL (#1189) — the short form shown on a table row.
 *
 * ⚠️ Short on purpose: the row already carries a name, a type, a symbol, a watchlist, up to three
 * protocol chips, leg results and two numbers. `Control — no thesis` is right on the bot page and
 * far too long here, so the LIST says `Control` and the page it links to says the rest.
 */
const THEORY_KIND_LABEL = {
  asymmetry: 'Asymmetry',
  participation: 'Participation',
  regime: 'Regime',
  control: 'Control',
};

/**
 * TheoryMark — what TYPE of claim this bot makes, and how much has been observed.
 *
 * ⚠️ RENDERS NOTHING when the bot has no theory, and that is a deliberate asymmetry with the rest
 * of this page: `chipFaulty` above is loud because a bot with no subscription SILENTLY does nothing,
 * whereas a bot with no theory still trades exactly as designed — it is merely unexplained. The
 * fleet-wide count lives in the header. What must NOT happen is "no theory" and "very short theory"
 * looking alike, so the chip is only drawn when the prose is non-empty (`hasTheory`).
 */
function TheoryMark({ strategy }) {
  const kind = strategy.theoryKind ? THEORY_KIND_LABEL[strategy.theoryKind] : null;
  const count = strategy.trackRecordCount;
  const obsTitle =
    count === null || count === undefined
      ? 'Track record could not be read — this is NOT "nothing observed".'
      : `${count} observation${count === 1 ? '' : 's'} recorded against this bot.`;

  if (!strategy.hasTheory && (count === null || count === undefined || count === 0)) return null;

  return (
    <>
      {strategy.hasTheory && (
        <span
          className={`${styles.chip} ${kind === 'Control' ? styles.chipTheory : styles.chipTheoryClaim}`}
          title={
            kind
              ? `${kind} — this is the kind of claim the bot's theory makes. Read it on the bot page.`
              : 'This bot has a theory, but no kind declared.'
          }
        >
          {kind || 'Theory'}
        </span>
      )}
      {(count !== null && count !== undefined) && count > 0 ? (
        <span className={`${styles.chip} ${styles.chipObs}`} title={obsTitle}>
          {count} obs
        </span>
      ) : count === null ? (
        <span className={`${styles.chip} ${styles.chipObs}`} title={obsTitle}>
          obs ?
        </span>
      ) : null}
    </>
  );
}

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

/**
 * LegResults — what EACH LEG of a paired bot actually did (#1185).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE CHIPS WERE NOT ENOUGH
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * `ProtocolChips` above already shows one chip per subscription, so the fact that a bot holds a long
 * protocol and a short protocol was visible. What was NOT visible is the thing the pair exists for:
 * which leg earned and which leg gave it back. Two chips that both say "long"/"short" cannot tell an
 * operator whether to keep the short leg or drop it.
 *
 * ⚠️ `trades: 0` and "cannot judge" are different sentences here, and the card keeps them apart:
 *   · no trades      → `—` with "never fired" in the title (information)
 *   · unattributed   → counted separately, never folded into a leg (a trade closed before
 *                      2026-11-02 has no leg and saying so is the honest answer)
 *   · unpaired bot   → `—`, because one leg is not a pair and a lone number would imply a comparison
 *
 * ⚠️ Combined is shown BESIDE the legs, not instead of them: "the strategy made +9.10" is the number
 * a reader wants, and "+7.40 long / +1.70 short" is the number that explains it.
 */
function LegResults({ legs, unavailable }) {
  if (unavailable) {
    // ⚠️ NOT `?` — that glyph already means "unattributed trades" inside a healthy cell, and two
    // meanings for one mark in one column is how "cannot judge" gets read as "nothing there".
    // `—` is also wrong: it says "this bot has no leg", which is a claim about the bot.
    return <span className={styles.tdMuted} title="Leg results could not be loaded">⚠</span>;
  }
  if (!legs || !legs.paired) return <span className={styles.tdMuted}>—</span>;

  const fmtPnl = (v) => (v === null || v === undefined ? '?' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);
  const toneOf = (v) => (v > 0 ? 'var(--risk-normal)' : v < 0 ? 'var(--risk-critical)' : 'var(--ink-soft)');

  return (
    <span className={styles.legStack}>
      {legs.legs.map((leg) => (
        <span
          key={leg.protocolId}
          className={styles.legRow}
          title={
            leg.trades === 0
              ? `${leg.protocolId} (${leg.role}) — never fired in the closed-trade history`
              : `${leg.protocolId} (${leg.role}) — ${leg.trades} closed, ${leg.wins} won, ${leg.winRate}% win rate`
          }
        >
          <em className={styles.legRole}>{String(leg.role || '?').toUpperCase().slice(0, 1)}</em>
          <span className={styles.legTrades}>{leg.trades === 0 ? '—' : leg.trades}</span>
          <span className={styles.legPnl} style={{ color: toneOf(leg.totalPnl) }}>
            {leg.trades === 0 ? '' : fmtPnl(leg.totalPnl)}
          </span>
        </span>
      ))}
      <span className={styles.legCombined} title="Both legs together">
        Σ <span style={{ color: toneOf(legs.combined.totalPnl) }}>{fmtPnl(legs.combined.totalPnl)}</span>
      </span>
      {legs.unattributed?.trades > 0 && (
        // Named, not hidden: these closed before leg attribution existed and are NOT a leg.
        <span className={styles.legUnattributed} title={legs.unattributed.because}>
          ? {legs.unattributed.trades}
        </span>
      )}
    </span>
  );
}

/**
 * SortTh — a sortable column header.
 *
 * The ORDERING RULE is not re-implemented here: it comes from `core/use-sort.jsx` (`useSort`),
 * which is the one place nulls-last, numeric-vs-text and the `aria-sort` vocabulary are decided.
 * Only the MARKUP is local, because `SortableTh` in that file hardcodes the Backtest Lab's
 * `bt-sort` classes and a CSS module hashes its own names — the two cannot share a button style
 * without dragging a global stylesheet onto this page.
 *
 * ⚠️ The button lives INSIDE the `<th>` so the column keeps its table semantics and the `aria-sort`
 * value is announced with the header. A clickable `<th>` alone would not be reachable by keyboard.
 */
function SortTh({ col, label, title, api, className, firstDir = 'desc' }) {
  const active = api.sortKey === col;
  return (
    <th scope="col" aria-sort={api.ariaSort(col)} className={className} title={title}>
      <button
        type="button"
        className={`${styles.sortBtn}${active ? ` ${styles.sortOn}` : ''}`}
        onClick={() => api.toggle(col, firstDir)}
      >
        {label}
        <span className={styles.sortArrow} aria-hidden="true">{active ? (api.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

export default function StrategiesListPage() {
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('all'); // all | active | disabled | trading | scoring | faulty
  const [search, setSearch] = useState('');
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

  // #1189 — the narrative tally for the header. `observations` is null when ANY row reported an
  // unreadable count: a partial sum would understate the fleet and read as a fact.
  const theoryTally = useMemo(() => {
    if (!strategies?.length) return null;
    const withTheory = strategies.filter((s) => s.hasTheory).length;
    const counts = strategies.map((s) => s.trackRecordCount);
    const observations = counts.some((c) => c === null || c === undefined)
      ? null
      : counts.reduce((a, c) => a + (c || 0), 0);
    return { total: strategies.length, withTheory, observations };
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

  // ── Per-leg results (#1185) ──
  //
  // A separate, non-blocking read: the list must render whether or not this answers, because it is
  // enrichment rather than the page's subject. It is NOT wrapped in `.catch()` — that would make a
  // transport failure render `—`, which is the same mark as "this bot has no leg" (a claim about the
  // bot rather than about the request, #782 / §7 of the dev philosophy). `isError` renders `?`
  // instead, so "cannot judge" never wears the face of "nothing there".
  const { data: legData, isError: legsUnavailable } = useQuery({
    queryKey: ['strategy-legs'],
    queryFn: () => apiGet('/api/trading/strategy-legs'),
    refetchInterval: 120_000,
  });

  const legsById = useMemo(() => {
    const map = {};
    for (const b of (legData?.bots || [])) map[b.strategyId] = b;
    return map;
  }, [legData]);

  // ── Filter → search → sort ──
  const filtered = useMemo(() => filterStrategies(strategies, filter), [strategies, filter]);
  const searched = useMemo(() => filtered.filter((s) => matchesBotSearch(s, search)), [filtered, search]);

  /**
   * The rows the table actually renders.
   *
   * ⚠️ TYPE, WATCHLIST, PROTOCOLS, LEGS AND POS ARE DERIVED, so they cannot be sorted on the raw
   * API object — `useSort` reads `row[key]`, and sorting on a value the cell does not display is
   * the "plausible number, wrong basis" defect in table form. Each is computed ONCE here and then
   * both rendered and sorted, so the two can never disagree.
   *
   * ⚠️ `watchlistLabel` reads `watchlists[]` because `watchlistName` IS NOT ON THIS PAYLOAD —
   * measured 2026-11-04, the column rendered `—` on all 68 rows. `watchlistName` is kept as the
   * fallback so a future server field of that name still wins.
   */
  const rows = useMemo(() => searched.map((s, i) => {
    const watchlistNames = (Array.isArray(s.watchlists) ? s.watchlists : [])
      .map((w) => (typeof w === 'string' ? w : w?.name))
      .filter(Boolean);
    return {
      ...s,
      rank: i + 1,
      typeLabel: isTradingStrategy(s) ? 'Trading' : isScoringStrategy(s) ? 'Scoring' : 'Strategy',
      watchlistLabel: watchlistNames.join(', ') || s.watchlistName || '—',
      protocolCount: Array.isArray(s.protocols) ? s.protocols.length : 0,
      posCount: posBySymbol[String(s.symbol || '').toUpperCase()] || 0,
      legPnl: legsById[s.id]?.combined?.totalPnl ?? null,
    };
  }), [searched, posBySymbol, legsById]);

  // Sorting is opt-in: until a header is clicked the list keeps the server's registry order.
  const sort = useSort(rows, null, 'desc');

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
        {/* The page title lives in the breadcrumb (`.main-top-row`), and `index.css` hides a
            page-level `h1` — so it is kept only for the "exactly one h1" landmark rule. */}
        <h1>Trading Bots</h1>

        {/* ── Control bar ─────────────────────────────────────────────────────────────────────
            Modelled on `.lad-toolbar` (LadderPage, `/scoring/live-ordering-stack`): ONE panel row
            holding every control for the table. Controls scattered into the page header read as
            unrelated to the table they act on, and the header had no width to give them.

            ⚠️ The descriptions and the live tally are NOT here any more — they sit behind the ℹ
            popover at the end of the row, which is the app's idiom for "what is this page" text
            (`components/PageInfoPopover`, the same trigger as the Ladder). */}
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <span className={styles.searchIcon} aria-hidden="true">⌕</span>
            <input
              type="search"
              className={styles.searchInput}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search bots, symbols, protocols…"
              aria-label="Search bots by name, symbol, watchlist, protocol, broker or active state"
            />
            {search && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setSearch('')}
                aria-label="Clear search"
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className={styles.filterBar}>
            {/* ⚠️ `disabled` is the COMPLEMENT of `active`, not an extra facet — `active` is the
                kill-switch column, so every bot is in exactly one of the two. Measured 2026-11-04:
                61 of the 68 bots are switched off, and before this chip they were only reachable by
                scanning the unfiltered list for grey status dots. Appended last so the positions of
                the existing chips — which operators know by position — do not move. */}
            {['all', 'active', 'trading', 'scoring', 'faulty', 'disabled'].map(f => (
              <button
                key={f}
                className={`${styles.filterChip} ${filter === f ? styles.filterActive : ''} ${f === 'faulty' ? styles.filterFaulty : ''}`}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* ⚠️ A `<div>`, not a `<span>`: `PageInfoPopover` renders a `<div>` popover, and flow
              content inside phrasing content is invalid nesting (the same defect `appearance-area.css`
              records against a `<p>`). */}
          <div className={styles.toolbarInfo}>
            <PageInfoPopover label="About this bot list">
              {isError ? (
                <p className={styles.popoverLine}>
                  <strong>The registry could not be read.</strong> GET /api/trading/strategies failed,
                  so this is a failed read — not an empty registry, and no bot has been deleted.
                </p>
              ) : (
                <>
                  <p className={styles.popoverLine}>
                    <strong>{strategies.length} bots</strong> — trading, scoring, and monitoring. The
                    list refreshes every 15 seconds.
                  </p>
                  {/* #1189 — the narrative tally. An ABSENT theory is a fact about the fleet, and a
                      per-row "no theory" badge on 60+ rows is noise nobody reads. Counting it once
                      keeps the absence visible without spending a column on it. ⚠️ When the counts
                      could not be read the line says so and shows no number — `null` (cannot judge)
                      must never render as `0` (nothing observed); those are different facts. */}
                  {theoryTally && (
                    <p className={styles.popoverLine}>
                      <strong>{theoryTally.withTheory} of {theoryTally.total}</strong> have a theory
                      {' · '}
                      {theoryTally.observations == null
                        ? 'track record unavailable'
                        : `${theoryTally.observations} observation${theoryTally.observations === 1 ? '' : 's'} recorded`}
                    </p>
                  )}
                  <p className={styles.popoverLine}>
                    Click a column header to sort, and click it again to reverse. Select a row to see
                    that bot's configuration in the panel beside the table.
                  </p>
                </>
              )}
            </PageInfoPopover>
          </div>
        </div>
      </motion.header>

      {/* #1193 — the active-bot ceiling for this install's progression level. Above the table on
          purpose: it explains what the toggles below will REFUSE, and a refusal discovered by
          clicking is a refusal with no context. */}
      <ProgressionPanel />

      {isError && (
        <EmptyState
          icon="⚠️"
          title="Unable to load bots"
          description="The request to GET /api/trading/strategies failed. This is a failed read, NOT an empty registry — no bot has been deleted or disabled. Check the API is running."
        />
      )}
      {toggleError && (
        <div className={styles.toggleError}>
          {/* ⚠️ NoticeBlock, NOT title+message. The hand-rolled banner below rendered `message` and
              `action` but DROPPED `cause`, which is where the server's specifics land: a refused
              activation showed "The request to the API failed (HTTP 400)" and nothing about WHY the
              bot was refused. NoticeBlock is the one renderer (components/NoticeBlock.jsx) and shows
              the cause and the stable code. */}
          <NoticeBlock notice={toggleError.notice} compact />
        </div>
      )}
      {!isLoading && faultyStrategies.length > 0 && filter !== 'faulty' && (
        <div className={styles.faultyBanner}>
          <span>⚠️ {faultyStrategies.length} bot{faultyStrategies.length !== 1 ? 's' : ''} with data issues</span>
          <button className={styles.faultyBannerBtn} onClick={() => setFilter('faulty')}>View faulty</button>
        </div>
      )}
      {/* ⚠️ `!isError` is load-bearing. Without it a FAILED read renders "No bots" beside the error
          block, and "there are none" is a very different claim from "the request failed".
          ⚠️ And the SEARCH is its own empty state, with its own escape. "Nothing matches this
          filter" while a search term is hiding 61 of 68 bots misreports WHY — the failure
          `LadderEmptyState` documents at length. */}
      {!isLoading && !isError && rows.length === 0 && (
        search.trim() ? (
          <EmptyState
            icon="🔍"
            title={`No bots match “${search.trim()}”`}
            description="The registry loaded, but no bot matches this search. Clear the search to see the list again."
            actionLabel="Clear search"
            actionOnClick={() => setSearch('')}
          />
        ) : (
          <EmptyState icon="🎯" title="No bots" description="Nothing matches this filter." />
        )
      )}

      {/* ── ONE bot table, plus a sticky sidebar for the selected row ───────────────────────────────
          This replaced an accordion grid. Selecting a card expanded it IN PLACE, which pushed every
          row below it down the page and made two bots impossible to compare — the shape the owner
          asked to change on 2026-09-23 ("lets change this view to a table").

          ⚠️ THE CLASSES ARE MODULE-SCOPED ON PURPOSE, and that is the point of this rewrite rather
          than a copy. The layout being adopted lived in `trading-strategies.css` under a SHARED
          `ts-*` namespace, which had ALREADY caused two pages to style each other. Measured
          2026-09-17: `/trading/trading-strategies` `.ts-header` reported `display:flex` and
          `border-bottom:1px` that its own stylesheet never declares, because `MetaStackCockpitPage`
          also uses `ts-header`. All page CSS is bundled globally, so a plain class name is a global
          namespace. A CSS module hashes the name and that collision cannot recur here. */}
      <div className={styles.split}>
        <div className={styles.tablePane}>
          <table className={styles.table}>
            <thead>
              <tr>
                {/* `#` is the bot's REGISTRY position and is sortable like any other column: sorting
                    it ascending restores the server's order, which is also the only way back out of
                    a sort once one is applied. It shows the registry rank rather than the row's
                    on-screen index so the number stays a fact about the bot, not about the sort. */}
                <SortTh col="rank" label="#" api={sort} className={styles.thRank} firstDir="asc" title="Registry order — the position the bot is registered in" />
                <SortTh col="name" label="Bot" api={sort} firstDir="asc" />
                <SortTh col="typeLabel" label="Type" api={sort} firstDir="asc" />
                <SortTh col="symbol" label="Symbol" api={sort} firstDir="asc" />
                <SortTh col="watchlistLabel" label="Watchlist" api={sort} firstDir="asc" />
                <SortTh col="protocolCount" label="Protocols" api={sort} title="Number of protocol subscriptions — routing joins strategy_protocol, not the legacy protocolId column" />
                <SortTh col="legPnl" label="Legs" api={sort} title="Per-leg closed-trade results: trades and P&L for each leg of a paired bot, then the combined total" />
                <SortTh col="brokerId" label="Broker" api={sort} className={styles.thNum} firstDir="asc" />
                <SortTh col="lastComposite" label="Score" api={sort} className={styles.thNum} />
                <SortTh col="posCount" label="Pos" api={sort} className={styles.thNum} />
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map((s) => {
                const isActive = isActiveStrategy(s);
                // The chip tone follows the LABEL the derived row already carries, so the colour and
                // the text cannot disagree.
                const typeColor = s.typeLabel === 'Trading' ? 'var(--accent)' : s.typeLabel === 'Scoring' ? 'var(--risk-watch)' : 'var(--ink-soft)';

                return (
                  <tr
                    key={s.id}
                    className={`${styles.row} ${selectedId === s.id ? styles.rowSelected : ''}`}
                    onClick={() => setSelectedId(selectedId === s.id ? null : s.id)}
                  >
                    <td className={styles.tdRank}>{s.rank}</td>
                    <td>
                      <span className={styles.nameCell}>
                        <span className={styles.cardDot} style={{ background: isActive ? STATUS_COLORS.active : STATUS_COLORS.disabled }} />
                        <strong>{s.name}</strong>
                      </span>
                      <TheoryMark strategy={s} />
                      <StrategyFaultBadge strategy={s} className={styles.rowFault} />
                    </td>
                    <td>
                      <span className={styles.cardType} style={{ background: `color-mix(in srgb, ${typeColor} 12%, transparent)`, color: 'var(--ink)', borderColor: typeColor }}>
                        {s.typeLabel}
                      </span>
                    </td>
                    <td>
                      <strong>{s.symbol || '—'}</strong>
                      {Number(s.maxPyramidTiers) > 1 && (
                        // ⚠️ PYRAMID PRESENCE (2026-11-04, owner request). Pyramid is an OPTIONAL
                        // per-bot mechanism and part of what makes one strategy distinct from
                        // another, so the global view has to show when it is ON. Rendered from the
                        // same declared field the rules view reads (`bot-rules.ts`), not a
                        // hand-rolled duplicate of the rule.
                        <span
                          className={styles.cardType}
                          style={{ marginLeft: 6, fontSize: 11 }}
                          title={`Pyramid ON — up to ${s.maxPyramidTiers} tiers (scale-in allowed when a tier's conditions are met)`}
                        >
                          ⟂{s.maxPyramidTiers}
                        </span>
                      )}
                    </td>
                    <td className={styles.tdMuted}>{s.watchlistLabel}</td>
                    <td><ProtocolChips strategies={s} /></td>
                    <td><LegResults legs={legsById[s.id]} unavailable={legsUnavailable} /></td>
                    <td className={styles.tdNum}>{s.brokerId || '—'}</td>
                    <td className={styles.tdNum}>
                      {s.lastComposite != null ? (
                        <span style={{ color: s.lastComposite >= 60 ? 'var(--risk-normal)' : s.lastComposite >= 40 ? 'var(--risk-elevated)' : 'var(--risk-critical)', fontWeight: 700 }}>
                          {s.lastComposite}
                        </span>
                      ) : (
                        <span className={styles.tdMuted}>—</span>
                      )}
                    </td>
                    <td className={styles.tdNum}>
                      {s.posCount > 0 ? <span className={styles.posChip}>{s.posCount}</span> : <span className={styles.tdMuted}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* The sidebar. It shows the SELECTED bot and nothing else, so the table never moves when a
            selection changes — which is the whole reason for the two-pane shape.
            `aria-live="polite"` announces the change: a screen-reader user gets no visual cue that
            clicking a row altered something else on the page. */}
        <aside className={styles.sidebar} aria-live="polite">
          {(() => {
            const sel = strategies.find((s) => s.id === selectedId) || null;
            if (!sel) {
              return (
                <p className={styles.sidebarEmpty}>
                  Select a bot to see its configuration, and to open the full rules view.
                </p>
              );
            }
            return (
              <>
                <h2 className={styles.sidebarTitle}>{sel.name}</h2>
                <p className={styles.sidebarSub}>
                  {sel.symbol || 'no symbol'} · {sel.mode || 'mode unset'} · broker {sel.brokerId || '—'}
                </p>
                {sel.description && <p className={styles.detailDesc}>{sel.description}</p>}

                <div className={styles.detailGrid}>
                  <span>Base Size: <strong>{sel.baseSize || '—'}</strong></span>
                  <span>SL: <strong>{sel.slPct != null ? sel.slPct + '%' : '—'}</strong></span>
                  <span>TP: <strong>{sel.tpPct != null ? sel.tpPct + '%' : '—'}</strong></span>
                  <span>Min Composite: <strong>{sel.minComposite || '—'}</strong></span>
                  <span>Timeframe: <strong>{sel.timeframe || '—'}</strong></span>
                  <span>Last Score: <strong>{sel.lastComposite ?? '—'}</strong></span>
                </div>

                <label className={styles.toggleRow}>
                  <span>Active</span>
                  <ToggleSwitch checked={isActiveStrategy(sel)} onChange={() => handleToggle(sel.id)} />
                </label>

                {/* Hand-off to the per-bot truth view (#864). The fields above are hand-picked; that
                    page shows all 29 declared rules with each one's ENFORCEMENT status, so a field
                    like Max Positions reads here as a working cap when the live cap is actually the
                    global risk.maxOpenPositions setting. */}
                <button
                  type="button"
                  className={styles.truthBtn}
                  onClick={() => navigate(`/trading/strategy/${sel.id}`)}
                >
                  Truth view — all 29 rules + enforcement →
                </button>

                {/* #985 §2 — the SECOND path to the SAME view, settings only. */}
                <button
                  type="button"
                  className={styles.truthBtn}
                  onClick={() => navigate(`/trading/strategy/${sel.id}?view=settings`)}
                >
                  Settings only — configuration without the audit →
                </button>
              </>
            );
          })()}
        </aside>
      </div>

      {/* ⚠️ MOUNTED BELOW THE TABLE ON PURPOSE. The owner's complaint began at the Score column and
          then said "this is about more than the column of this table" — so the panel sits under the
          table it explains, reading the same `strategies` list, rather than on a separate route the
          reader has to know about. */}
      <ScoringMechanicsPanel strategies={strategies} />

    </div>
  );
}
