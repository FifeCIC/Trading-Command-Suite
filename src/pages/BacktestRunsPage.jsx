import { lazy, Suspense } from 'react';
import './BacktestRunsPage.css';

const BacktestRunsPanel = lazy(() => import('../components/backtest/BacktestRunsPanel'));

/**
 * BacktestRunsPage — "Completed runs", moved off `/lab/backtest-strategies` (owner direction 2026-10-31).
 *
 * ⚠️ WHY IT IS ITS OWN PAGE. That page had reached eleven numbered steps plus four reference tabs, and
 * the owner's own note was *"I'm realising this one page is very complex especially with the [Completed
 * runs] added"*. Stored runs are not part of assembling a run — they are their own job: review what the
 * engine has kept, select two to four, and find out what changed. A tab inside a measurement form made
 * both harder.
 *
 * ⚠️ IT IS THE SAME COMPONENT, NOT A COPY. `BacktestRunsPanel` is imported, so the A/B baseline pinning,
 * the verdict bar, the delete guard and the "what differs" table have ONE implementation. Duplicating it
 * for a page would guarantee the two drift and only one gets the next fix.
 *
 * ⚠️ NO VISIBLE PAGE HEADER (owner direction, 2026-10-31: *"Remove … as it is duplicate information"*).
 * The page shell already renders this view's own label ("Completed Runs") from `view-meta.js`, and the
 * panel's first line already carries the instruction ("Select 2–4 runs…"), so a heading plus a lede put
 * the same two things on screen twice before any data. The `<h2>` is kept `sr-only` because it is what
 * names the page for a screen reader, and there is no visual heading left to read it from.
 */
export default function BacktestRunsPage() {
  return (
    <div className="btrp-page">
      <h2 className="sr-only">Completed runs</h2>
      <Suspense fallback={<p className="pb-none">Loading completed runs…</p>}>
        <BacktestRunsPanel showTrades />
      </Suspense>
    </div>
  );
}
