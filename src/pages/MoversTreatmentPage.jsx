/**
 * MoversTreatmentPage — the MARKET-WIDE question: what is moving anywhere, that we are not watching?
 * =================================================================================================
 *
 * Owner, 2026-11-18: *"We need to separate [Our registered symbols] and [Market-wide] as they're two
 * totally different concepts."* … *"[this page] can then focus on being fed by a live market feed of
 * the top winners and losers."*
 *
 * ── THE SPLIT, AND WHICH HALF LIVES WHERE ────────────────────────────────────────────────────────
 *   `/watchlists/registered-movers`  — bounded by OUR universe. "What is TCS doing with the symbols we
 *                                      hold?" That is a Watchlists question, because a symbol is "ours"
 *                                      by virtue of `symbol_protocol_assignment`.
 *   `/development/movers-treatment`  — bounded by nothing. Discovery, fed by the live movers feed.
 *                                      That is a Development question, because the answer is not yet a
 *                                      capability — it is what the strategy will be built on.
 *
 * They used to share one page behind two tabs. A tab hidden behind another tab is not a separation:
 * the two answered different questions, from different data sources, for different audiences — and
 * only one of them should ever be offered to someone who has not asked for a prototype.
 *
 * ── ⚠️ NOTHING HERE READS `/api/scoring/movers-treatment` ANY MORE ──
 * That endpoint answers "what did TCS do about a symbol WE hold", which is the Watchlists page's
 * question. Calling it here would have kept a second copy of the treatment table alive on a page that
 * has no treatment to show.
 *
 * ── ⚠️ THE STRATEGY IS A STATUS, NOT A PANEL ──
 * Owner, 2026-11-18: *"which basically constitutes a status (do not need all the text displayed until
 * the user hovers over the status)."* It stays on THIS page because this is where the discovery side
 * of the strategy is being built; the Watchlists page is an operational view.
 *
 * ── ⚠️ WITHHELD FROM OTHER USERS BY DEFAULT ──
 * Registered in `DEFAULT_HIDDEN_ROUTES` (`src/core/hidden-views.js`). Every new page defaults to
 * withheld — `scripts/validate-page-visibility.cjs` fails the build otherwise.
 */
import MarketMoversPanel from '../components/MarketMoversPanel';
import StatusCard from '../components/StatusCard';
import './MoversTreatmentPage.css';

export default function MoversTreatmentPage() {
  return (
    <div className="mt-page">
      {/* One h1 for assistive tech; the nav and breadcrumb carry it visually. See the docblock. */}
      <h1 className="sr-only">Market movers — winners and losers anywhere</h1>

      {/* ⚠️ THE ℹ IS NOT RENDERED HERE (2026-11-18). It belongs to the shell, at the top right of
          `.main-top-row` in line with the breadcrumbs; this page contributes its text through
          `VIEW_EXPLANATIONS['movers-treatment']`. The local copy used to sit in a right-aligned
          `.mt-head` row, which put the app's most-repeated control in a different place on this page
          from every other page — the inconsistency `validate-page-chrome.cjs` now fails the build on. */}

      {/* ── The strategy this page exists for, as a STATUS with its reason on demand ── */}
      <div className="mt-status-row">
        <StatusCard
          icon="🚧"
          value="INACTIVE"
          label="Parabolic momentum — winners & losers"
          tone="warn"
          detail={
            <>
              <strong>Not available yet:</strong> the strategy has no protocol to score with, so there
              is nothing to switch on. When it exists, its tab will appear here, gated on its protocol
              being active.
              <br />
              <br />
              The feed below is live regardless. What the strategy adds is the decision layer on top of
              it: velocity and acceleration rather than a single percentage, exhaustion detection, and a
              two-sided reaction when a rocket runs out of fuel or a submarine touches bottom.
            </>
          }
        />
      </div>

      <MarketMoversPanel />
    </div>
  );
}
