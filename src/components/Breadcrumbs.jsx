import { useParams, Link } from 'react-router-dom';
import { NAV_TREE } from '../core/nav-tree';

/**
 * Breadcrumbs — maps the current /:area/:view route to boxed pill segments.
 * Renders: [Home] [Area] [View]
 */
export default function Breadcrumbs() {
  const { area, view } = useParams();

  if (!area) return null;

  const areaEntry = NAV_TREE[area];
  const areaLabel = areaEntry?.label || area;
  const viewLabel = areaEntry?.views?.find((v) => v.id === view)?.label || view || '';

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to="/" className="breadcrumbs-pill">Home</Link>
      <Link to={`/${area}`} className="breadcrumbs-pill">{areaLabel}</Link>
      {view && (
        <span className="breadcrumbs-pill breadcrumbs-current">{viewLabel}</span>
      )}
    </nav>
  );
}
