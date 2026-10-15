/**
 * AppearanceSurfacesPage — the Surfaces & Cards group of the Appearance area.
 *
 * ⚠️ THIN WRAPPER, DELIBERATELY. The examples live in ONE file (`ThemeLabSections`) and this page
 * selects a group from it. Copying the markup here would be a second implementation to keep in step.
 *
 * ⚠️ SAMPLE VALUES ARE TOKENS AND CONTROLS, NEVER INVENTED DATA. Owner direction for this area
 * (2026-10-13): *"Only use this apps own real data to create examples"* — a demo that shows a made-up
 * ticker, price or P&L reads as a working feature. Colour swatches and form fields are not data
 * claims; anything that shows app CONTENT must render the real thing.
 */
import { useQuery } from '@tanstack/react-query';
import PageInfoPopover from '../components/PageInfoPopover';
import LoadingSkeleton from '../components/LoadingSkeleton';
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
          From /status/meta-stack-explorer (rated 9/10), where the owner said: *"I like this large high
          impact notice … create a list of samples like this with the purpose being to get the attention
          of the user or summarise."* The class names are the source page's; the values are live.

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
