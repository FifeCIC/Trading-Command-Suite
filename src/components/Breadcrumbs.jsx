import { useParams, Link } from 'react-router-dom';
import { NAV_TREE } from '../core/nav-tree';

/**
 * Breadcrumbs — maps the current /:area/:view route to human-readable labels.
 * Renders: Home > Area Label > Page Label
 */
export default function Breadcrumbs() {
  const { area, view } = useParams();

  if (!area) return null;

  const areaEntry = NAV_TREE[area];
  const areaLabel = areaEntry?.label || area;
  const viewLabel = areaEntry?.views?.find((v) => v.id === view)?.label || view || '';

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to="/">Home</Link>
      <span className="breadcrumbs-sep">›</span>
      <Link to={`/${area}`}>{areaLabel}</Link>
      {view && (
        <>
          <span className="breadcrumbs-sep">›</span>
          <span className="breadcrumbs-current">{viewLabel}</span>
        </>
      )}
    </nav>
  );
}
