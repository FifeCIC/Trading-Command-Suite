import PageInfoPopover from './PageInfoPopover';
import { usePageInfoContent } from '../core/top-row-slot';

/**
 * MainTopInfo — the ONE ℹ on a page, rendered by the shell in `.main-top-row`.
 *
 * =============================================================================
 * WHY THIS EXISTS (owner direction, 2026-11-18)
 *
 *   "I also don't like the pages primary ℹ being in different places: please ensure it is in the
 *    same location for all pages… the top right of main, or in the top row so it is in line with
 *    the breadcrumbs."
 *
 * Measured at the time: **73 pages** rendered their own `PageInfoPopover`, and **131** rendered an
 * `<h1>` — some of them with the ℹ inside the `<h1>`, so the trigger's position depended on that
 * page's own stylesheet. `index.css` already says the page title belongs to the breadcrumb
 * (`.main-stage h1 { display: none }`), but three page stylesheets re-declared `display` on `h1`
 * and un-hid it — `accounts.module.css` even carried a comment claiming the title was "hidden
 * app-wide" directly above the rule that showed it.
 *
 * So the position is not a per-page decision. A page contributes TEXT (via `VIEW_EXPLANATIONS`)
 * and live figures (via `<PageInfoSlotContent>`); the shell decides where they appear. A page that
 * renders its own trigger is a second explanation in a second place, which is the inconsistency
 * this component removes.
 *
 * ⚠️ It renders NOTHING when there is neither an explanation nor slot content — the same rule as
 * `TopRowSlotHost`. An always-rendered wrapper keeps `.main-top-right` non-empty, which defeats the
 * `index.css` rule that collapses `.main-top-row` when it holds nothing (measured as a 1885 × 6px
 * empty bar on the dashboard).
 */
export default function MainTopInfo({ explanation }) {
  const pageInfo = usePageInfoContent();
  if (!explanation && !pageInfo) return null;

  return (
    <div className="main-top-info">
      <PageInfoPopover label="About this page">
        {explanation}
        {pageInfo}
      </PageInfoPopover>
    </div>
  );
}
