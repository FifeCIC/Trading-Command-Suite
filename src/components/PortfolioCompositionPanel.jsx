/**
 * PortfolioCompositionPanel — what the holdings are made of, as a share of value.
 *
 * ── WHERE THIS CAME FROM (2026-11-28) ───────────────────────────────────────────────────────────
 * This is the **Allocation** block ported off `PortfolioPage.jsx` (`/trading/portfolio-overview`) so
 * that page could be merged into the one the nav item actually opens
 * (`/trading212/t212-portfolio`). That page was in NO menu, so its Allocation bar, its Broker
 * Breakdown, its mode-mismatch warning and its T212 sell control were all unreachable — the whole
 * reason for the merge. Nothing here is a second implementation; the old block is deleted with it.
 *
 * ── WHY IT TAKES ROWS AS A PROP INSTEAD OF FETCHING ─────────────────────────────────────────────
 * The merged page already holds every holding it renders (`combinedPositions`). A component that
 * fetched its own copy could disagree with the table directly beneath it, which is the failure the
 * contribution panel's docblock records. One fetch, one derivation, both surfaces.
 *
 * ── THE BASIS IS STATED, NOT ASSUMED ────────────────────────────────────────────────────────────
 * A share of value is only meaningful when every row is in the SAME currency. A Trading212 holding
 * reports an account-currency value; an MT5 position reports `volume × contractSize × price` — a
 * NOTIONAL in the instrument's own currency. Adding those and drawing one bar would produce a
 * plausible number that means nothing. So the caller declares `unit` and the excluded row count is
 * printed rather than hidden: `null` is "cannot judge", never 0.
 */
import EmptyState from './EmptyState.jsx';
import { formatAmount } from '../core/format-utils.js';
import './portfolio-composition.css';

/** How many slices before the tail is grouped. 8 keeps every legend label readable at 320px. */
const MAX_SLICES = 8;

function buildSlices(rows) {
  const usable = [];
  let excluded = 0;
  for (const r of rows) {
    if (Number.isFinite(r.value) && r.value > 0) usable.push(r);
    else excluded += 1;
  }
  const total = usable.reduce((sum, r) => sum + r.value, 0);
  if (!(total > 0)) return { slices: [], total: null, excluded, grouped: 0 };
  usable.sort((a, b) => b.value - a.value);
  const head = usable.slice(0, MAX_SLICES);
  const tail = usable.slice(MAX_SLICES);
  const slices = head.map((r) => ({
    key: r.key ?? r.ticker,
    label: r.ticker,
    value: r.value,
    pct: (r.value / total) * 100,
  }));
  if (tail.length) {
    const rest = tail.reduce((sum, r) => sum + r.value, 0);
    slices.push({
      key: '__other',
      label: `Other (${tail.length})`,
      value: rest,
      pct: (rest / total) * 100,
    });
  }
  return { slices, total, excluded, grouped: tail.length };
}

export default function PortfolioCompositionPanel({ rows = [], unit = 'account currency', emptyDescription }) {
  const { slices, total, excluded } = buildSlices(rows);

  if (!slices.length) {
    return (
      <EmptyState
        icon="◔"
        title="Nothing to apportion yet"
        description={
          emptyDescription
          ?? 'No holding on this page reports a value in a single currency, so a share of value cannot be computed. Rows whose value is a notional in another currency are excluded rather than mixed in.'
        }
      />
    );
  }

  return (
    <div className="pcomp">
      {/*
        The bar is the visual; the legend is the data. `role="img"` with a one-sentence label means a
        screen reader is told the shape rather than read a list of divs, and every figure it encodes
        is repeated in the table below it — so nothing is pointer-only (WCAG 1.1.1).
      */}
      <div
        className="pcomp-bar"
        role="img"
        aria-label={`Composition by value: ${slices
          .slice(0, 3)
          .map((s) => `${s.label} ${s.pct.toFixed(1)} percent`)
          .join(', ')}${slices.length > 3 ? `, and ${slices.length - 3} more` : ''}. Figures listed below.`}
      >
        {slices.map((s, i) => (
          <span
            key={s.key}
            className="pcomp-seg"
            style={{
              // Ordinal ramp of ONE hue, not a categorical palette: the slices are sorted by value,
              // so their order carries the meaning. A repeated categorical colour would imply a
              // grouping that does not exist, and a fixed hex palette would ignore the theme pack.
              '--pcomp-fill': `color-mix(in oklab, var(--accent) ${100 - i * 9}%, transparent)`,
              flexGrow: s.pct,
            }}
            title={`${s.label}: ${s.pct.toFixed(1)}%`}
          />
        ))}
      </div>

      <table className="pcomp-table">
        <caption className="pcomp-caption">
          Share of {formatAmount(total)} — in {unit}.
          {excluded > 0 && ` ${excluded} row${excluded === 1 ? '' : 's'} excluded (no value in this unit).`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Holding</th>
            <th scope="col" className="pcomp-num">Value</th>
            <th scope="col" className="pcomp-num">Share</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((s, i) => (
            <tr key={s.key}>
              <th scope="row">
                <span
                  className="pcomp-swatch"
                  style={{ '--pcomp-fill': `color-mix(in oklab, var(--accent) ${100 - i * 9}%, transparent)` }}
                  aria-hidden="true"
                />
                {s.label}
              </th>
              <td className="pcomp-num">{formatAmount(s.value)}</td>
              <td className="pcomp-num">{s.pct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
