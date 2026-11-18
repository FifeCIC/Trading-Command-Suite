import { lazy, Suspense } from 'react';
import './BacktestExperimentsPage.css';

const BacktestExperimentsPanel = lazy(() => import('../components/backtest/BacktestExperimentsPanel'));

/**
 * BacktestExperimentsPage — the backtest experiment registry (#1295).
 *
 * ⚠️ WHY IT IS ITS OWN PAGE. The automation registry has `/trading/ab-strategies`; this one had only
 * `npm run report:backtest-experiments`. A command is unusable to an owner who should not be spending
 * tokens to ask an agent, so a comparison existed only if somebody remembered it — measured at the
 * time: 1,722 runs, **13** filed.
 *
 * ⚠️ NO VISIBLE PAGE HEADER, matching BacktestRunsPage (owner direction 2026-10-31: *"Remove … as it
 * is duplicate information"*). The shell renders this view's label from `view-meta.js`, so a heading
 * here would put the same words on screen twice. The `<h2>` stays `sr-only` because it is what names
 * the page for a screen reader.
 */
export default function BacktestExperimentsPage() {
  return (
    <div className="bxp-page">
      <h2 className="sr-only">Backtest experiments</h2>
      <Suspense fallback={<p className="bx-note">Loading the registry…</p>}>
        <BacktestExperimentsPanel />
      </Suspense>
    </div>
  );
}
