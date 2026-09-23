import { useParams, Link } from 'react-router-dom';
import { NAV_TREE } from '../core/nav-tree';
import VariantSwitcher from './VariantSwitcher';

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
        <span className="breadcrumbs-pill breadcrumbs-current">{viewLabel}</span>
      )}
      {showDesignSwitcher && <VariantSwitcher />}
    </nav>
  );
}
