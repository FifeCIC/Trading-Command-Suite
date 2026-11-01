/**
 * RsiDivergencePanel — the settings, the chart, and the honest line between them.
 *
 * ── TWO HOSTS, ONE COMPONENT (owner direction, 2026-11-01) ──────────────────────────────────────
 * *"The RSIDivergence class should support both clearly so the work done now shouldn't go to waste."*
 *
 *   • IN-STEP — pass `symbol` / `timeframe` and it inherits the Lab's selection, rendering no subject
 *     controls of its own. This is the mount that exists today: step 7, **Directive overrides**, on
 *     `Backtest Protocols`.
 *   • FULL PAGE — pass NOTHING and it renders its own symbol + timeframe inputs, so it stands alone in
 *     any area that wants a whole-page divergence workspace. Nothing is hardcoded to the Lab.
 *
 * ⚠️ WHAT IT MUST NEVER DO AGAIN: sit ABOVE the step machine on the Lab page. That was tried first and it
 * read as a redesign of the view — the steps ARE the page. A full-page version belongs in ANOTHER area,
 * not outside the steps of this one.
 *
 * ── WHAT THIS SOLVES ────────────────────────────────────────────────────────────────────────────
 * *"I will edit inputs, the chart will show me potential outcomes, then I will move onto the next step and
 * run the backtest which should use the new inputs."*
 *
 * So this is a TUNING surface, not a results surface: every control refreshes the picture immediately and
 * nothing is stored. The run happens later, in step 10, from the settings this panel leaves behind.
 *
 * ── THE TWO BADGES THAT MATTER ───────────────────────────────────────────────────────────────────
 * `used by the run` vs `preview only` is not decoration. Several knobs below come from the SOURCE
 * indicator (`RSIDivLE`) and change what the chart draws, but `rsi-divergence.directive.ts` does not read
 * them yet — so a setting marked **preview only** changes what you SEE and not what you RUN. The badge list
 * comes from the API's own `scope.honouredInScoring`, so the two cannot drift.
 *
 * ── WHY THE CHART DEBOUNCES ─────────────────────────────────────────────────────────────────────
 * A slider drag fires dozens of changes; each is a round trip that reads up to 1,500 bars from MySQL.
 * 300ms of quiet is enough to feel instant and cheap.
 */
import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiPost } from '../../core/api/client.js';
import InfoNote from '../InfoNote';
import NoticeBlock from '../NoticeBlock';
import { noticeFromError } from '../../core/notices/from-error.js';
import RsiDivergenceChart from './RsiDivergenceChart.jsx';
/**
 * ⚠️ THE ACCEPTED TABLE STYLE, IMPORTED RATHER THAN REINVENTED (owner, 2026-11-01: *"This table … needs
 * styling from one of the accepted designs in the Appearance area"*).
 *
 * `dv-table` is the **dense-read** table the Appearance area lists as one of five accepted purposes —
 * owner score 4/10 for the PAGE, with the praise aimed at the table itself: *"a simplistic solution"*.
 * A list of found divergences is a dense read: many rows, no per-row actions, columns compared
 * vertically. That is this job exactly.
 *
 * ⚠️ Importing another page's stylesheet is deliberate and is the pattern the Appearance page itself
 * uses — *"These are not lookalikes. Each example imports the real stylesheet from the view it came
 * from."* A local copy would drift from the design the owner approved.
 */
import '../../pages/directive-viewer.css';

/**
 * The source indicator's defaults, so the panel opens looking like TradingView and not like our
 * directive. `rsiPeriod` is the one place they differ (Pine 9, ours 14) and the badge says which is live.
 */
const DEFAULTS = {
  rsiPeriod: 14,
  leftLookback: 1,
  rightLookback: 3,
  minGapBars: 5,
  maxGapBars: 60,
  showRegularBullish: true,
  showHiddenBullish: true,
  showRegularBearish: true,
  showHiddenBearish: false,
};

/**
 * Fallback only — used until the first response arrives. ⚠️ After that the badges read
 * `preview.scope.honouredInScoring`, which is computed server-side, so the panel cannot drift from the
 * service's own idea of what the scorer reads. A local list that disagreed with the API would be worse
 * than no badge: it would be a confident claim in the wrong direction.
 */
const HONOURED_FALLBACK = new Set(['rsiPeriod', 'rightLookback']);

const NUMBER_FIELDS = [
  { key: 'rsiPeriod', label: 'RSI period', unit: 'bars', min: 2, max: 60, pine: 'len', hint: 'Pine default is 9; our directive ships 14.' },
  { key: 'leftLookback', label: 'Pivot lookback — left', unit: 'bars', min: 1, max: 20, pine: 'lbL', hint: 'How many bars to the left a pivot must beat.' },
  { key: 'rightLookback', label: 'Pivot lookback — right', unit: 'bars', min: 1, max: 20, pine: 'lbR', hint: 'Bars to the right — this is also the confirmation delay.' },
  { key: 'minGapBars', label: 'Min bars between pivots', unit: 'bars', min: 1, max: 200, pine: 'rangeLower', hint: 'Closer than this and the two pivots are treated as one move.' },
  { key: 'maxGapBars', label: 'Max bars between pivots', unit: 'bars', min: 2, max: 500, pine: 'rangeUpper', hint: 'Further apart than this and the pair is stale.' },
];

const TOGGLE_FIELDS = [
  { key: 'showRegularBullish', label: 'Regular bullish', pine: 'plotBull' },
  { key: 'showHiddenBullish', label: 'Hidden bullish', pine: 'plotHiddenBull' },
  { key: 'showRegularBearish', label: 'Regular bearish', pine: 'plotBear' },
  { key: 'showHiddenBearish', label: 'Hidden bearish', pine: 'plotHiddenBearish' },
];

export default function RsiDivergencePanel({ symbol, timeframe, days, periodId, inSelectedProtocol }) {
  const [params, setParams] = useState(DEFAULTS);
  /** Debounced copy of `params` — the chart follows this, the inputs follow the state above. */
  const [settled, setSettled] = useState(DEFAULTS);
  /**
   * ⚠️ THE PANEL CARRIES ITS OWN SUBJECT SO IT CANNOT BE UNREACHABLE (measured 2026-11-01).
   * `divergence-suite-v1` is the ONLY protocol containing `rsi-divergence`, and it resolves **no symbols,
   * no watchlist and no bot** — so the Lab's step 2 refuses to advance and a panel that inherited its
   * symbol would never render for anyone. Rather than hide the tool behind wiring that does not exist, it
   * takes an explicit subject and falls back to the page's selection when there is one.
   */
  const [ownSymbol, setOwnSymbol] = useState(symbol || 'NVDA');
  const [ownTimeframe, setOwnTimeframe] = useState(timeframe || '15m');
  const effectiveSymbol = symbol || ownSymbol;
  const effectiveTimeframe = timeframe || ownTimeframe;

  useEffect(() => {
    const t = setTimeout(() => setSettled(params), 300);
    return () => clearTimeout(t);
  }, [params]);

  const request = useMemo(() => ({
    symbol: effectiveSymbol,
    timeframe: effectiveTimeframe,
    directiveId: 'rsi-divergence',
    ...(periodId ? { periodId } : { days: days ?? 30 }),
    params: settled,
  }), [effectiveSymbol, effectiveTimeframe, periodId, days, settled]);

  const q = useQuery({
    // ⚠️ The whole request is in the key, so React Query treats a settings change as a NEW query rather
    // than a refetch of an old one. `placeholderData` keeps the previous chart on screen while the new
    // one loads, which is what makes a slider feel attached to the picture.
    queryKey: ['bt-directive-preview', request],
    queryFn: () => apiPost('/api/backtest/directive-preview', request),
    enabled: Boolean(effectiveSymbol && effectiveTimeframe),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    retry: false,
  });

  const preview = q.data;
  const summary = preview?.summary;
  /**
   * Which controls the RUN reads — from the API when it has answered, from the fallback before that.
   * The toggles are always preview-only today, so they keep their static badge; the numeric fields read
   * this set, which is the one the service computes.
   */
  const honoured = useMemo(
    () => new Set(preview?.scope?.honouredInScoring ?? [...HONOURED_FALLBACK]),
    [preview],
  );
  const changed = JSON.stringify(params) !== JSON.stringify(DEFAULTS);

  return (
    <>
      <InfoNote
        tone="neutral"
        label="RSI divergence preview"
        meta={`${effectiveSymbol} · ${effectiveTimeframe} · ${preview?.window?.bars ?? '…'} bars${summary ? ` · ${summary.divergences} pair(s)` : ''}`}
      >
        Adjust a setting and the picture redraws. <strong>Nothing is stored and no run happens here</strong> —
        these values are a preview of what the detector sees, and the buttons in step 10 run the backtest.
        {inSelectedProtocol === false && (
          <>
            {' '}<strong>This protocol does not include <code>rsi-divergence</code></strong> — the chart still
            works, but a run of the selected protocol will not score it.
          </>
        )}
      </InfoNote>

      <div className="bt-div-panel">
        <div className="bt-div-controls">
          {/* Only when the page has not already decided the subject — otherwise it would be a second,
              competing symbol control on a step that already has one. */}
          {!symbol && (
            <label title="Which instrument to preview">
              <span className="bt-div-label">Symbol</span>
              <input value={ownSymbol} onChange={(e) => setOwnSymbol(e.target.value.toUpperCase())} />
            </label>
          )}
          {!timeframe && (
            <label title="Which timeframe to preview">
              <span className="bt-div-label">Timeframe</span>
              <select value={ownTimeframe} onChange={(e) => setOwnTimeframe(e.target.value)}>
                {['5m', '15m', '1h', '4h', '1d'].map((tf) => <option key={tf} value={tf}>{tf}</option>)}
              </select>
            </label>
          )}
          {NUMBER_FIELDS.map((f) => (
            <label key={f.key} title={`${f.hint} (source: ${f.pine})`}>
              <span className="bt-div-label">
                {f.label}
                <span className={`bt-div-badge ${honoured.has(f.key) ? 'is-honoured' : 'is-preview'}`}>
                  {honoured.has(f.key) ? 'used by the run' : 'preview only'}
                </span>
              </span>
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={1}
                value={params[f.key]}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setParams((p) => ({ ...p, [f.key]: Number.isFinite(n) ? n : p[f.key] }));
                }}
              />
              <span className="bt-field-gloss">{f.hint}</span>
            </label>
          ))}

          <fieldset className="bt-div-toggles">
            <legend>Which kinds to detect</legend>
            {TOGGLE_FIELDS.map((f) => (
              <label key={f.key} className="bt-div-toggle" title={`Pine: ${f.pine}`}>
                <input
                  type="checkbox"
                  checked={params[f.key]}
                  onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.checked }))}
                />
                <span>{f.label}</span>
                <span className="bt-div-badge is-preview">preview only</span>
              </label>
            ))}
          </fieldset>

          {changed && (
            <button type="button" className="bt-panel-btn bt-panel-btn-sm" onClick={() => setParams(DEFAULTS)}>
              Reset to source defaults
            </button>
          )}
        </div>

        <div className="bt-div-view">
          {q.isError && (
            <NoticeBlock
              notice={noticeFromError(q.error, 'TCS-SYS-007', { operation: 'preview the RSI divergence settings' })}
              compact
            />
          )}
          {preview && <RsiDivergenceChart preview={preview} />}
          {!preview && !q.isError && <p className="pb-none">Reading bars for the first picture…</p>}
        </div>
      </div>

      {preview && summary && (
        <>
          <div className="bt-table-wrap">
            <table className="bt-table bt-facts-table">
              <caption className="sr-only">Divergences found with the current settings</caption>
              <tbody>
                <tr>
                  <td>Pairs found</td>
                  <td className="pb-mono">{summary.divergences}</td>
                  <td>Bars carrying a score</td>
                  <td className="pb-mono">{summary.scoredBars}</td>
                </tr>
                <tr>
                  <td>Regular bullish</td>
                  <td className="pb-mono">{summary.byKind['regular-bullish'] ?? 0}</td>
                  <td>Hidden bullish</td>
                  <td className="pb-mono">{summary.byKind['hidden-bullish'] ?? 0}</td>
                </tr>
                <tr>
                  <td>Regular bearish</td>
                  <td className="pb-mono">{summary.byKind['regular-bearish'] ?? 0}</td>
                  <td>Hidden bearish</td>
                  <td className="pb-mono">{summary.byKind['hidden-bearish'] ?? 0}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/*
            ⚠️ THIS SENTENCE IS THE POINT OF THE BADGES ABOVE. A reader who tunes a preview-only knob and then
            runs a backtest must not conclude the knob was tested — the scorer did not read it.
          */}
          {preview.scope?.previewOnly?.length > 0 && (
            <InfoNote tone="warning" label="These settings change the chart, not the run">
              <strong>{preview.scope.previewOnly.length}</strong> of the settings above are not read by
              <code> rsi-divergence</code> yet: <code>{preview.scope.previewOnly.join(', ')}</code>. Only{' '}
              <code>{preview.scope.honouredInScoring.join(', ')}</code> reach the scorer, so a backtest run from
              this page will use the directive&rsquo;s own values for the rest.
            </InfoNote>
          )}

          {preview.divergences?.length > 0 && (
            <div className="dv-table-wrap">
              <table className="dv-table">
                <caption className="sr-only">Every divergence pair found in this window</caption>
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Confirmed</th>
                    <th scope="col">Price</th>
                    <th scope="col">RSI</th>
                    <th scope="col">Strength</th>
                    <th scope="col">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.divergences.map((d, i) => (
                    <tr key={`${d.kind}-${d.toIndex}-${i}`}>
                      <td>{d.kind.replace('-', ' ')}</td>
                      <td className="dv-mono">{String(preview.bars[d.toIndex]?.time ?? '').slice(0, 16).replace('T', ' ')}</td>
                      <td className="dv-mono">{d.fromPrice} → {d.toPrice}</td>
                      <td className="dv-mono">{d.fromRsi} → {d.toRsi}</td>
                      <td className="dv-mono">{d.strength}%</td>
                      <td className="dv-mono">{d.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
