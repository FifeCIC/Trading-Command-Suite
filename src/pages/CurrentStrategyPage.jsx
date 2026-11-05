/**
 * CurrentStrategyPage — "/lab/current-strategy". The focused strategy, and how its latest run compares
 * with the one that was accepted.
 *
 * ── WHY THIS IS ITS OWN PAGE (owner direction, 2026-11-04) ──────────────────────────────────────
 * *"I wanted a 'Current Strategy' page added to the 'Lab' and everything I highlighted moved to that
 * new page. Simplifying the 'Backtest Strategies' page a little as right now it has results displayed
 * twice."*
 *
 * The first attempt made this a TAB on `/lab/backtest-strategies`. That was the wrong shape: the
 * backtest page's job is to RUN a measurement, and the A/B panels were a second rendering of results
 * on the same screen as the first. Moving them here means the backtest page shows one result and this
 * page shows the standing comparison, and neither repeats the other.
 *
 * The two columns are deliberate and were called out to be kept: A (the accepted reference) and B (the
 * latest run, or a pinned one) side by side, because "is this better than what I accepted?" is a
 * question that cannot be answered from one panel at a time.
 *
 * ⚠️ WHICH STRATEGY this page is about comes from the app-wide focus (`currentStrategyId` in the
 * preference store), written by the Backtest Lab when a strategy is selected. That is what makes
 * "Current Strategy" a real subject rather than a label: the same focus can be read by any page.
 *
 * 🛑 THIS PAGE DOES NOT RUN A BACKTEST AND DOES NOT CHANGE A BOT. It reads stored runs and moves the
 * ACCEPTED REFERENCE (`backtest.baseline.<protocol>.runId`). Accepting a run does not touch
 * `trading_strategy`, does not make a copy, and does not place anything.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client.js';
import { usePreferences } from '../core/hooks/usePreferences';
import { useBacktestBaseline } from '../core/use-backtest-baseline.js';
import { RunPanel, RunSettingsDiff, RunDiffPanel } from '../components/backtest/RunComparisonPanels.jsx';
import InfoNote from '../components/InfoNote';
import './backtest-lab.css';
import '../components/backtest/backtest-panel-base.css';
import './CurrentStrategyPage.css';

export default function CurrentStrategyPage() {
  const { prefs, set: setPref } = usePreferences();
  const focusedId = prefs.currentStrategyId || '';

  const botsQuery = useQuery({
    queryKey: ['cs-bots'],
    queryFn: () => apiGet('/api/trading/strategies').catch(() => null),
    staleTime: 60_000,
  });
  const bots = useMemo(() => {
    const raw = botsQuery.data;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : (raw.strategies ?? []);
    return Array.isArray(list) ? list.filter((b) => b && b.id) : [];
  }, [botsQuery.data]);

  const bot = useMemo(() => bots.find((b) => b.id === focusedId) ?? null, [bots, focusedId]);

  /**
   * The baseline is scoped to a PROTOCOL, because two protocols score different directives against
   * different symbols and their runs are not comparable. The bot supplies the scope.
   */
  const scope = bot?.protocolId || 'all';
  const baseline = useBacktestBaseline(scope);
  const baselineRunId = baseline.runId;

  const runsQuery = useQuery({
    queryKey: ['cs-runs', bot?.protocolId ?? 'all'],
    queryFn: () => apiGet(
      `/api/backtest/runs?limit=20${bot?.protocolId ? `&protocolId=${encodeURIComponent(bot.protocolId)}` : ''}`,
    ).catch(() => null),
    staleTime: 15_000,
    enabled: Boolean(bot),
  });
  const runs = useMemo(() => {
    const raw = runsQuery.data;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : (raw.runs ?? []);
  }, [runsQuery.data]);

  /** A pinned B. `null` follows the latest run, which is the default. */
  const [pickedBId, setPickedBId] = useState(null);
  const latestRunId = runs[0]?.id ?? null;
  const bRunId = pickedBId ?? latestRunId;

  /**
   * One labelled line of the bot's LIVE record. The A/B pair is a measurement of the ENGINE, so without
   * this the only live evidence on the page would be two backtests.
   */
  const liveRefQuery = useQuery({
    queryKey: ['cs-bot-performance'],
    queryFn: () => apiGet('/api/trading/bot-performance').catch(() => null),
    enabled: Boolean(focusedId),
    staleTime: 60_000,
  });
  const liveReference = (() => {
    if (!focusedId) return null;
    const perf = (liveRefQuery.data?.bots ?? []).find((b) => b.botId === focusedId);
    if (!perf) return null;
    const r = perf.realised ?? {};
    return `${r.samples ?? 0} closed trade(s) · win ${r.winRate == null ? '—' : `${(Number(r.winRate) * 100).toFixed(1)}%`} · expectancy ${r.expectancy ?? '—'} · total ${r.totalPnl ?? '—'} (reliability: ${r.reliability ?? '—'})`;
  })();

  const acceptBaseline = (runId) => baseline.accept(runId);
  const clearBaseline = () => baseline.clear();

  return (
    <div className="pb-page">
      <header className="cs-header">
        <h2>Current Strategy</h2>
        <p className="cs-lede">
          The strategy you are focused on, and how its latest run compares with the run you accepted.
          Accepting a run only moves the <strong>reference</strong> — it never changes the bot&rsquo;s
          own settings and never places an order.
        </p>
      </header>

      <div className="cs-focus-bar">
        <label className="cs-focus-label" htmlFor="cs-strategy">Focused strategy</label>
        <select
          id="cs-strategy"
          className="ff-select"
          value={focusedId}
          onChange={(e) => {
            setPickedBId(null);
            setPref('currentStrategyId', e.target.value);
          }}
        >
          <option value="">— choose a strategy —</option>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}{b.active ? ' · ACTIVE' : ''}{b.protocolId ? ` · ${b.protocolId}` : ''}
            </option>
          ))}
        </select>
        {bot && (
          <span className="cs-focus-meta">
            {bot.symbol || 'no symbol'} · {bot.timeframe || 'no timeframe'}
            {bot.protocolId ? ` · protocol ${bot.protocolId}` : ' · no protocol'}
          </span>
        )}
      </div>

      {!bot && (
        <InfoNote tone="warning" label="Nothing focused" meta={botsQuery.isLoading ? 'loading the strategy list…' : undefined}>
          {botsQuery.isError
            ? '⚠️ The strategy list could not be read, so this is unknown rather than empty.'
            : 'Pick a strategy above, or select one on Backtest Strategies — that selection is remembered and appears here.'}
        </InfoNote>
      )}

      {bot && (
        <>
          {liveReference && (
            <InfoNote tone="neutral" label="Live record" meta="the bot's real closed trades, from /api/trading/bot-performance">
              {liveReference}
            </InfoNote>
          )}

          {/* ── THE PAIR ON ONE ROW ─────────────────────────────────────────────────────────────
              Which run is A, which is B, and the control that changes B. The ids, not the words —
              "accepted baseline" and "latest" are what the two columns already say. */}
          {runs.length > 0 && (
            <div className="bt-pair-bar">
              <div className="bt-pair-side">
                <span className="bt-pair-role">A</span>
                {baselineRunId
                  ? <code className="bt-pair-id">{String(baselineRunId).slice(0, 8)}</code>
                  : <span className="bt-pair-empty">none accepted</span>}
                {baselineRunId && <span className="dp-badge dp-badge--override">accepted</span>}
              </div>

              <span className="bt-pair-arrow" aria-hidden="true">→</span>

              <div className="bt-pair-side">
                <span className="bt-pair-role">B</span>
                <select
                  className="ff-select bt-pair-select"
                  value={pickedBId ?? ''}
                  aria-label="Which stored run is B in this comparison"
                  title="Leave on Latest to follow the newest run, or pin one run to compare against a pair that does not move under you."
                  onChange={(e) => setPickedBId(e.target.value || null)}
                >
                  <option value="">Latest · {String(latestRunId ?? '').slice(0, 8)}</option>
                  {runs.slice(0, 20).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id.slice(0, 8)} · {r.period}
                    </option>
                  ))}
                </select>
                {pickedBId && (
                  <button type="button" className="bt-pair-unpin" onClick={() => setPickedBId(null)} title="Go back to following the latest run">
                    unpin
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="bt-pair-grid">
            <RunPanel
              role="A"
              runId={baselineRunId}
              accepted
              onClear={baselineRunId ? clearBaseline : null}
              liveReference={liveReference}
              showTrades
              emptyHint={
                baseline.source === 'loading'
                  ? 'Checking the stored baseline…'
                  : baseline.source === 'unreadable'
                    ? '⚠️ The accepted baseline could not be READ, so this is unknown rather than empty. Retry, or accept a run from the B column to replace it.'
                    : baseline.source === 'invalid'
                      ? '⚠️ The stored baseline row could not be parsed. Accept a run from the B column to replace it.'
                      : 'No baseline accepted for this protocol yet. Accept the latest run from the B column — it becomes A, and every later run is measured against it.'
              }
            />

            <RunPanel
              role="B"
              runId={bRunId}
              onAccept={bRunId ? () => acceptBaseline(bRunId) : null}
              showTrades
              emptyHint="No backtest has been stored for this protocol yet, so there is nothing in B to compare against A."
            />
          </div>

          {/* ⚠️ SETTINGS BEFORE SCORES: they are the CAUSE. "1,204 bars changed" without "the spread
              moved 0.01% → 0.93%" is a number with no explanation (#1141). */}
          <RunSettingsDiff aId={baselineRunId} bId={bRunId} />
          <RunDiffPanel aId={baselineRunId} bId={bRunId} showTrades />
        </>
      )}
    </div>
  );
}
