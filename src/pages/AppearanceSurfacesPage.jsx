/**
 * AppearanceSurfacesPage — the Surfaces & Cards group of the Appearance area.
 *
 * ⚠️ THIN WRAPPER, DELIBERATELY. The examples live in ONE file (`ThemeLabSections`) and this page
 * selects a group from it. Copying the markup here would be a second implementation to keep in step.
 *
 * ⚠️ SAMPLE VALUES ARE TOKENS AND CONTROLS, NEVER INVENTED DATA. Requirement for this area
 * (2026-10-13): *"Only use this apps own real data to create examples"* — a demo that shows a made-up
 * ticker, price or P&L reads as a working feature. Colour swatches and form fields are not data
 * claims; anything that shows app CONTENT must render the real thing.
 */
import { useQuery } from '@tanstack/react-query';
import PageInfoPopover from '../components/PageInfoPopover';
import LoadingSkeleton from '../components/LoadingSkeleton';
import StatusCard from '../components/StatusCard';
import { apiGet } from '../core/api/client';
import { ThemeLabSections } from './ThemeLabSections';
import './theme-lab.css';
import './appearance-area.css';
// ⚠️ The source page's own stylesheet, imported so the banner below is the real thing rather than a
// lookalike — the same approach as /appearance/data-display.
import './meta-stack-explorer.css';

export default function AppearanceSurfacesPage() {
  const rankedQ = useQuery({
    queryKey: ['surfaces-rank'],
    queryFn: () => apiGet('/api/scoring/ranked?limit=5').catch(() => null),
  });
  const top = (rankedQ.data?.ranked || [])[0] || null;

  return (
    <div className="appearance-area">
      <header className="appearance-head">
        
        <p className="appearance-lede">How a container should look. A plain card groups content; a neon-border or corner-glow card asserts STATUS — use those when the surface itself is making a point, not merely holding things.
        </p>
              <PageInfoPopover>Card backgrounds, neon border variants and corner-glow surfaces. The glowing treatments are for status (healthy, caution, critical) — using one decoratively spends the signal.</PageInfoPopover>
      </header>

      <ThemeLabSections group="surfaces" />

      {/* ── High-impact notice banner ─────────────────────────────────────────────────────────────
          From /status/meta-stack-explorer (rated 9/10), where the brief said: I like this large high
          impact notice … create a list of samples like this with the purpose being to get the attention
          of the user or summarise. The class names are the source page's; the values are live.

          ⚠️ TWO THINGS ARE DELIBERATELY ABSENT. The source wraps this in `RevealCard` + framer-motion
          (the Motion page covers animation), and it supports an `mse-signal-verified` modifier that
          stamps “✓ Pipeline Verified”. That badge is a CLAIM about the pipeline, so it is not shown
          here — a sample must not assert a verification that nothing performed. */}
      <section className="tl-section">
        <h3>High-impact notice banner</h3>
        <p className="tl-hint">
          One element whose job is to stop the eye: a symbol, its signal, the composite, and the few
          facts behind it. Live values from <code>/api/scoring/ranked</code>.
        </p>
        {rankedQ.isLoading && <LoadingSkeleton variant="card" count={1} />}
        {rankedQ.isError && (
          <p className="tl-hint">Could not load a signal to banner — the request failed.</p>
        )}
        {!rankedQ.isLoading && !rankedQ.isError && !top && (
          <p className="tl-hint">Nothing is scored at the moment, so there is no signal to show.</p>
        )}
        {top && (
          <div className={`mse-signal-banner mse-signal-${bannerTone(top.signal)}`}>
            <div className="mse-signal-main">
              <span className="mse-signal-symbol">{top.ticker}</span>
              <span className={`mse-signal-badge mse-signal-badge-${bannerTone(top.signal)}`}>
                {top.signal}
              </span>
              <span className="mse-signal-composite">
                {top.score}
                {typeof top.maxPossibleScore === 'number' ? `/${top.maxPossibleScore}` : ''}
                {typeof top.normalizedScore === 'number'
                  ? ` · ${Number(top.normalizedScore).toFixed(2)}%`
                  : ''}
              </span>
            </div>
            <div className="mse-signal-meta">
              <span>
                Directives: {top.activeDirectives}/{top.totalDirectives}
              </span>
              <span>Confidence: {top.confidence ?? '—'}</span>
              <span>Data: {top.dataStatus || '—'}</span>
            </div>
          </div>
        )}
      </section>

      {/* ── Status cards: the number is the answer, the detail is on demand ────────────────────────
          Requirement (2026-11-18), reviewing /development/movers-treatment: *"I do not like screen clutter -
          large blocks of information need to be displayed through the users desire to see it … some of
          the values within it could be status cards … and hovering over tells us more information. This
          should be a standard approach presented in the Appearance area to encourage it. Maybe a small
          icon in the top right corner of cards that have additional information would help users
          realise that there is more to read."*

          ⚠️ THE VALUES ARE LIVE, FROM `/api/scoring/ranked` — the endpoint this page already calls for
          the banner above. An appearance sample that invents a count teaches a shape nobody can
          recognise when it appears on a real page. */}
      <section className="tl-section">
        <h3>Status card — a number whose justification is on demand</h3>
        <p className="tl-hint">
          `src/components/StatusCard.jsx`. The number and a two-word label are always visible; the
          sentence that explains what the number MEANS waits until it is asked for. Hover, focus, or
          click the card — the <strong>chevron on the right edge</strong> points down when closed and
          up when open. A card with nothing more to say is <strong>not</strong> a button.
        </p>
        {rankedQ.isLoading && <LoadingSkeleton variant="card" count={1} />}
        {!rankedQ.isLoading && !rankedQ.data?.ranked && (
          <p className="tl-hint">
            ⚠️ The ranking request failed, so there is nothing to count — that is <strong>not</strong>{' '}
            &ldquo;nothing is scored&rdquo;. No card is shown rather than a card holding a made-up number.
          </p>
        )}
        {rankedQ.data?.ranked && (
          <div className="tl-status-row">
            <StatusCard
              value={rankedQ.data.ranked.length}
              label="signals returned"
              detail={
                <>
                  From <code>GET /api/scoring/ranked?limit=5</code> — the same request that fills the
                  banner above. The count is what the endpoint returned, not how many symbols the app
                  holds: <strong>{rankedQ.data.ranked.length} is not a coverage figure.</strong>
                </>
              }
            />
            <StatusCard
              value={rankedQ.data.ranked.filter((r) => r.dataStatus === 'live').length}
              tone="ok"
              label="live data"
              detail={
                <>
                  Of those {rankedQ.data.ranked.length}, the ones reporting{' '}
                  <code>dataStatus: &apos;live&apos;</code>. The rest are served from cache —
                  a cached score is still a score, but it is a score of older bars, and a card that did
                  not say so would be hiding the difference.
                </>
              }
            />
            {/* ⚠️ The third state, and the one this app keeps paying for: CANNOT JUDGE. An em dash is
                the honest headline when the value is unknown; a 0 would assert "none". */}
            <StatusCard
              value="—"
              tone="warn"
              label="a value nobody measured"
              detail={
                <>
                  This card deliberately shows no number. There is no source for it on this page, and an
                  em dash plus an explanation is the honest rendering — <strong>0 would be a claim
                  nobody made</strong>. Use this shape whenever a figure is missing rather than zero.
                </>
              }
            />
          </div>
        )}
        <ul className="ap-reject">
          <li>
            <strong>A card with no detail is not a button</strong> — it renders as a plain surface with
            no chevron. Making it clickable invites a click that reports no change.
          </li>
          <li>
            <strong>The cue is a chevron, never an ⓘ</strong> — ⓘ means “information about this thing”
            and belongs on a heading (<code>PageInfoPopover</code>); a card that <em>expands</em> takes
            the chevron, which is what Material, Apple and the WAI-ARIA accordion pattern all use.
          </li>
          <li>
            <strong>The detail is never hover-only</strong> — <code>accessibility-policy</code> forbids
            it, and most of this app is used on a phone. Hover and focus reveal; click pins.
          </li>
          <li>
            <strong>Tone colours the border and label, never the body</strong> — the semantic tones fail
            WCAG AA as body text on a light panel (the same reason <code>InfoNote</code> restricts them).
          </li>
          <li>
            <strong>It is not an <code>InfoNote</code></strong> — a note annotates data already on
            screen; this replaces a block of prose that was taking up the screen in the first place.
          </li>
        </ul>
      </section>
    </div>
  );
}

/**
 * bannerTone — signal → the modifier the source stylesheet defines.
 * ⚠️ Only three exist: `.mse-signal-buy`, `-sell`, `-hold`. STRONG_BUY / STRONG_SELL fold into buy / sell,
 * which is exactly what `MetaStackExplorerPage` does (`signalClass`), so the sample cannot drift from it.
 * Anything unrecognised falls to `hold` rather than emitting a class no stylesheet defines.
 */
function bannerTone(signal) {
  const s = String(signal || '').toUpperCase();
  if (s.includes('BUY')) return 'buy';
  if (s.includes('SELL')) return 'sell';
  return 'hold';
}
