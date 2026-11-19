/**
 * QueuedChangesPage — the combined queue of protocol + bot changes we intend to TRY.
 * ==================================================================================
 *
 * Requirement (2026-11-19): the queue was rendered ABOVE the bot table on `/bots/trading-bots`
 * and *"is actually just becoming screen clutter and noise … it takes away focus on the bot table
 * itself"*. Moved to Development, where working-out-what-to-change belongs.
 *
 * ── WHY DEVELOPMENT, AND NOT A PANEL ON ANOTHER TRADING PAGE ─────────────────────────────────────
 * The queue is not a record of trading. It is a list of edits we are considering, most of which will
 * never be applied, and a reader looking at open positions should not have to scroll past it. The
 * Development area is where an experiment is proposed, measured and decided — so the proposal list
 * lives with it.
 *
 * ⚠️ THE BOTS PAGE KEEPS ITS PER-BOT QUEUE. `/bots/trading-bots` still renders the queue for the
 * SELECTED bot, because that one is about the row in front of you. What was removed is the
 * every-protocol-and-every-bot dump, which answered no question that page was asked.
 *
 * ⚠️ ONE COMPONENT, NOT A SECOND COPY. `SuggestionQueue` already owns the rendering, the three
 * scoping modes and the emptiness/refusal rules (`src/components/SuggestionQueue.jsx`). This page
 * only scopes it to "everything" — a second list here would drift from the one on the Protocols
 * page, and the reader would have to decide which to believe.
 *
 * ⚠️ NO PAGE `<h1>`, NO PAGE `PageInfoPopover`. Both belong to the shell: the title is the
 * breadcrumb, and the ℹ is rendered once at the top right of `.main-top-row`. The page's own
 * explanation is contributed through `VIEW_EXPLANATIONS['queued-changes']`. This is enforced by
 * `scripts/validate-page-chrome.cjs`.
 */
import SuggestionQueue from '../components/SuggestionQueue';
import './queued-changes.css';

export default function QueuedChangesPage() {
  return (
    <div className="qc-page">
      <SuggestionQueue mode="all" title="Queued changes — protocols and bots" />
    </div>
  );
}
