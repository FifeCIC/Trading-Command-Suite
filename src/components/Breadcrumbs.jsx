import { useParams, Link } from 'react-router-dom';
import { NAV_TREE } from '../core/nav-tree';
import ABSwitcher from './ABSwitcher';

/**
 * Breadcrumbs — maps the current /:area/:view route to boxed pill segments.
 * Renders: [Home] [Area] [View] [A|B]
 * The A|B toggle appears inline when the page supports A/B testing.
 */
export default function Breadcrumbs() {
  const { area, view } = useParams();

  if (!area) return null;

  const areaEntry = NAV_TREE[area];
  const areaLabel = areaEntry?.label || area;
  const viewLabel = areaEntry?.views?.find((v) => v.id === view)?.label || view || '';

  // A/B testing: show switcher for views that support it
  const abViews = ['protocols-registry', 'protocols'];
  const showAB = abViews.includes(view);

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to="/dashboard" className="breadcrumbs-pill">Dashboard</Link>
      <Link to={`/${area}`} className="breadcrumbs-pill">{areaLabel}</Link>
      {view && (
        <span className="breadcrumbs-pill breadcrumbs-current">{viewLabel}</span>
      )}
      {showAB && <ABSwitcher />}
    </nav>
  );
}
