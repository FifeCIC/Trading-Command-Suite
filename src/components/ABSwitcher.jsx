/**
 * ABSwitcher — Inline A/B variant toggle for page testing.
 * ==========================================================
 * Shows "A | B" toggle. B is the default; A adds ?variant=A.
 */

import { useSearchParams } from 'react-router-dom';
import './ab-switcher.css';

export default function ABSwitcher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isVariantA = searchParams.get('variant') === 'A';
  const active = isVariantA ? 'A' : 'B';

  const toggle = (v) => {
    if (v === 'B') {
      searchParams.delete('variant');
    } else {
      searchParams.set('variant', 'A');
    }
    setSearchParams(searchParams, { replace: true });
  };

  return (
    <span className="ab-switcher">
      <button
        className={`ab-btn ${active === 'A' ? 'ab-active' : ''}`}
        onClick={() => toggle('A')}
        title="Original page design"
      >A</button>
      <button
        className={`ab-btn ${active === 'B' ? 'ab-active' : ''}`}
        onClick={() => toggle('B')}
        title="Redesigned variant (default)"
      >B</button>
    </span>
  );
}
