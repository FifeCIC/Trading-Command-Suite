/**
 * EditionNotice — shown when a FREE-edition user reaches a view that is not in this edition.
 *
 * Why it exists: in the free build the premium pages are absent, so a stale bookmark or a
 * typed URL would otherwise hit the generic "This view has no page" fallback — which reads
 * like a bug. This says what is actually true and points back to the dashboard.
 * Reached only via the edition guard in App.jsx renderMainContent() (FREE-EDITION-PLAN.md §3).
 */
import { Link } from 'react-router-dom';
import './edition-notice.css';

export default function EditionNotice() {
  return (
    <section className="edition-notice" role="note" aria-label="Not included in this edition">
      <h2>Not included in this edition</h2>
      <p>
        This view is part of the full edition of the app. The free edition includes your
        accounts, market data, research tools and manual trading.
      </p>
      <p>
        <Link to="/">Return to the dashboard</Link>
      </p>
    </section>
  );
}
