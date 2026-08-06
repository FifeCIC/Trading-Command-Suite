/**
 * ABSwitcher — Inline A/B variant toggle for page testing.
 * ==========================================================
 * Shows "A | B" toggle that adds/removes ?variant=B from the URL.
 * The page component reads the param and renders the chosen variant.
 *
 * Usage: <ABSwitcher /> anywhere in the page header.
 * Page reads: const variant = new URLSearchParams(location.search).get('variant');
 */

import { useSearchParams } from 'react-router-dom';
import './ab-switcher.css';

export default function ABSwitcher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const variant = searchParams.get('variant') || 'A';

  const toggle = (v) => {
    if (v === 'A') {
      searchParams.delete('variant');
    } else {
      searchParams.set('variant', v);
    }
    setSearchParams(searchParams, { replace: true });
  };

  return (
    <span className="ab-switcher">
      <button
        className={`ab-btn ${variant === 'A' ? 'ab-active' : ''}`}
        onClick={() => toggle('A')}
        title="Original page design"
      >A</button>
      <button
        className={`ab-btn ${variant === 'B' ? 'ab-active' : ''}`}
        onClick={() => toggle('B')}
        title="Redesigned variant"
      >B</button>
    </span>
  );
}
