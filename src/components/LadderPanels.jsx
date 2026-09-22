/**
 * LadderPanels — the Ladder family's shared page furniture.
 * ===========================================================
 * Extracted 2026-09-22 when the A/B Ladder was built: the toolbar controls, the
 * empty-state branches and the "not passing filters" divider were copied from
 * `LadderPage.jsx`, and `validate-duplication.cjs` flagged the pair. The rule is
 * extract, not copy — a second copy drifts and only one gets the next fix.
 *
 * ⚠️ WHY THESE LIVE TOGETHER IN ONE FILE. They are one unit of furniture used by
 * exactly one page family; splitting into three files would add imports without
 * adding clarity. `ScoreCard.jsx` sets the precedent (multiple exports, one card).
 *
 * ⚠️ These components OWN their stylesheet import. In dev, Vite injects CSS only
 * when a module is imported, so a component that mounts `lad-` classes without
 * importing `ladder.css` renders unstyled on any page that has not imported it.
 */
import { AGE_OPTIONS, MARKET_OPTIONS } from '../core/score-card-filters';
import '../pages/ladder.css';

/**
 * LadderToolbar — the shared control row.
 *
 * `children` renders FIRST so each page can lead with its own scope control (the
 * Ladder's direction segmented control; the A/B Ladder's pair pickers) before the
 * common filters. Everything else is identical by construction — the two pages
 * cannot offer different Score-age options or a different market vocabulary.
 */
export function LadderToolbar({
  rankBy, onRankBy,
  ageFilter, onAgeFilter,
  marketFilter, onMarketFilter,
  search, onSearch,
  searchAriaLabel,
  children,
}) {
  return (
    <div className="lad-toolbar">
      {children}
      <label className="lad-filter">
        Score by:
        <select value={rankBy} onChange={(e) => onRankBy(e.target.value)}>
          <option value="signal">Signal</option>
          <option value="opp">Opportunity</option>
        </select>
      </label>
      <label className="lad-filter">
        Score age:
        <select value={ageFilter} onChange={(e) => onAgeFilter(e.target.value)}>
          <option value="all">All</option>
          {AGE_OPTIONS.map((m) => <option key={m} value={m}>≤ {m}m</option>)}
        </select>
      </label>
      <label className="lad-filter">
        Market:
        <select value={marketFilter} onChange={(e) => onMarketFilter(e.target.value)}>
          {MARKET_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </label>
      <label className="lad-search">
        <span className="lad-search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search symbol, protocol, state…"
          aria-label={searchAriaLabel}
        />
        {search && (
          <button
            type="button"
            className="lad-search-clear"
            onClick={() => onSearch('')}
            aria-label="Clear search"
            title="Clear search"
          >
            ×
          </button>
        )}
      </label>
    </div>
  );
}

/**
 * LadderEmptyState — the three reasons a ladder can be empty, each NAMED.
 *
 * ⚠️ The search branch must exist as its own case. Without it the panel once
 * claimed "none of the selected protocols have resolved symbols" while four were
 * selected and seven resolved — the search had hidden them. An empty result that
 * misreports WHY is the "nothing happened, and nothing said why" failure this
 * codebase treats as a defect, so search gets its own message and a one-click
 * escape.
 *
 * `subject` names what was scoped: the Ladder's 'selected-protocols' or the A/B
 * Ladder's 'pair'.
 */
export function LadderEmptyState({ search, onClearSearch, marketFilter, subject = 'selected-protocols' }) {
  const isPair = subject === 'pair';
  const scopeLabel = isPair ? 'this pair' : 'the selected protocols';

  if (search.trim()) {
    return (
      <div className="lad-empty">
        <p className="lad-empty-title">No cards match “{search.trim()}”.</p>
        <p>
          {isPair
            ? 'The pair has resolved symbols, but none match the search.'
            : 'The selected protocols have resolved symbols, but none match the search.'}
          {' '}
          <button type="button" className="lad-empty-action" onClick={onClearSearch}>
            Clear search
          </button>
        </p>
      </div>
    );
  }

  if (marketFilter === 'open') {
    return (
      <div className="lad-empty">
        <p className="lad-empty-title">No open-market symbols for {scopeLabel}.</p>
        <p>All matched cards are for a closed market. Switch the Market filter to All or Closed to see them.</p>
      </div>
    );
  }

  return (
    <div className="lad-empty">
      <p className="lad-empty-title">No symbols for {scopeLabel}.</p>
      <p>
        {isPair
          ? 'Neither protocol has resolved symbols to rank yet.'
          : 'None of the selected protocols have resolved symbols to rank yet.'}
      </p>
    </div>
  );
}

/**
 * LadderExcludedDivider — the seam above cards excluded by the score-age filter.
 * `noun` is the row's own word ('card' on the Ladder, 'row' on the A/B Ladder).
 */
export function LadderExcludedDivider({ count, noun = 'card' }) {
  return (
    <div className="lad-divider">
      <span className="lad-divider-label">Not passing filters</span>
      <span className="lad-divider-note">
        {count} {noun}{count === 1 ? '' : 's'} outside the selected score-age filter
      </span>
    </div>
  );
}
