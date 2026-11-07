import { useParams, Link } from 'react-router-dom';
import { NAV_TREE } from '../core/nav-tree';
import VariantSwitcher from './VariantSwitcher';
import { useRefreshPulse } from '../core/use-refresh-pulse.js';

/**
 * Breadcrumbs — maps the current /:area/:view route to boxed pill segments.
 * Renders: [Home] [Area] [View] [Old|New]
 * The Old|New toggle appears inline when the page ships two DESIGNS of itself.
 *
 * ⚠️ This is a page-design variant, NOT A/B testing. Called `ABSwitcher` until 2026-09-23, which
 * made a search for the app's real A/B work (locked protocol / strategy pairs) match page styling.
 */
export default function Breadcrumbs() {
  const { area, view } = useParams();
  /* The refresh countdown lives HERE so no page has to draw its own `⟳ 59s` any more (owner,
     2026-11-07). It is derived from the query cache — see use-refresh-pulse.js — so every polling
     page gets it for free and a page that does not poll gets nothing. */
  const pulse = useRefreshPulse();

  if (!area) return null;

  const areaEntry = NAV_TREE[area];
  const areaLabel = areaEntry?.label || area;
  const viewLabel = areaEntry?.views?.find((v) => v.id === view)?.label || view || '';

  // Views that ship two designs of themselves. Named `variantViews`, not `abViews` — see above.
  const variantViews = ['protocols-registry', 'protocols', 'symbols-ladder', 'signals-overview'];
  const showDesignSwitcher = variantViews.includes(view);

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to="/dashboard" className="breadcrumbs-pill">Dashboard</Link>
      <Link to={`/${area}`} className="breadcrumbs-pill">{areaLabel}</Link>
      {view && (
        <span
          className={`breadcrumbs-pill breadcrumbs-current${pulse.pct == null ? '' : pulse.fetching ? ' breadcrumbs-current--fetching' : ''}`}
          /* The bar itself is a pseudo-element fed by `--pulse`; the title is the accessible version of
             it, so a screen-reader user is told the same thing the bar shows. */
          style={pulse.pct == null ? undefined : { '--pulse': `${Math.round(pulse.pct * 100)}%` }}
          title={pulse.pct == null
            ? undefined
            : pulse.fetching
              ? 'Refreshing now'
              : `Refreshing in ${Math.max(0, Math.round(((1 - pulse.pct) * pulse.interval) / 1000))}s`}
        >
          {viewLabel}
          {pulse.pct != null && <span className="breadcrumbs-refresh-bar" aria-hidden="true" />}
        </span>
      )}
      {showDesignSwitcher && <VariantSwitcher />}
    </nav>
  );
}
