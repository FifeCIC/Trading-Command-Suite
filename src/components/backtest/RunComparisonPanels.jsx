/**
 * RunComparisonPanels — the A/B pair for the manual backtest experiment (#1143 follow-up).
 * =========================================================================================
 *
 * OWNER DIRECTION, 2026-10-26: *"we need another tab displaying 'Current Performance (A)' and the
 * other new tab for the most recent backtest 'Backtesting Results (B)'"* — and *"we need a step that
 * backtests using the current strategies settings at least once so that there is an outcome to
 * compare to. This is how we establish our new manual A/B testing."*
 *
 * WHAT A AND B ARE, precisely:
 *
 *   A — the bot's LIVE, realised record. Not a simulation. `GET /api/trading/bot-performance`
 *       counts closed trades attributed to that bot and reports its DECLARED settings beside them.
 *   B — the most recent stored backtest, with what it changed relative to the bot's own settings.
 *
 * ⚠️ THEY ARE NOT THE SAME KIND OF MEASUREMENT AND MUST NEVER BE AVERAGED OR DIFFED INTO ONE
 * NUMBER. A is a handful of real trades over an unknown window; B is a simulation over a window you
 * chose. The panel states each population rather than implying they are commensurate — which is the
 * same rule the verdict machine applies when it refuses to name a winner on a thin sample.
 *
 * ⚠️ AND THE SIZE DIFFERENCE IS NAMED, NOT ASSUMED AWAY. The live path sizes in LOTS from
 * `trading_strategy.baseSize`; the backtester sizes in UNITS from an equity model (#843). Until the
 * two share one sizing function, a money comparison between A and B is a comparison of two
 * different positions — so `botBaseSize` and the run's `positionModel` are both shown.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api/client.js';

const pct = (v) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`);
const num = (v, dp = 2) => (v == null ? '—' : Number(v).toFixed(dp));
const money = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(Number(v)).toFixed(2)}`);

/** The stored scoring output of one run. A component so tab A can show it with or without a bot. */
function ScoringOutput({ latestId, scoreSeries, protocolId }) {
  return (
    <>
      <h4 className="pb-info-head">Scoring output — most recent run</h4>
      {latestId == null ? (
        <p className="pb-none">No run stored yet, so there are no scores to show.</p>
      ) : !scoreSeries ? (
        <p className="pb-none">
          ⚠️ Run <code>{String(latestId).slice(0, 8)}</code> was made before scores were stored
          (2026-10-26), so its scoring output is <strong>not recorded</strong> — not &ldquo;no
          scores&rdquo;. Run it again to capture them.
        </p>
      ) : (
        <>
          <p className="pb-field-note">
            <strong>{scoreSeries.length}</strong> scored bar(s) from run{' '}
            <code>{String(latestId).slice(0, 8)}</code>.
            {protocolId ? <> Protocol <strong>{protocolId}</strong>.</> : null} These are read back
            from the stored run — nothing is re-scored here, because a panel that re-scores would be
            a second scoring path by definition.
          </p>
          <table className="bt-table">
            <caption className="sr-only">Every bar the most recent run scored</caption>
            <thead>
              <tr>
                <th scope="col">Bar</th>
                <th scope="col">Score</th>
                <th scope="col">Signal</th>
                <th scope="col">Passed the bot&rsquo;s bar</th>
              </tr>
            </thead>
            <tbody>
              {scoreSeries.slice(-25).map((s, i) => (
                <tr key={`${s.date}-${i}`}>
                  <td className="pb-mono">{s.date}</td>
                  <td className="pb-mono">{s.score}</td>
                  <td>{s.signal}</td>
                  <td>{s.passedBar ? 'yes' : 'no — below the bar'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

/** A — what the bot has ACTUALLY done, straight from the trades attributed to it. */
export function CurrentPerformancePanel({ botId, botName, baseSize }) {
  const q = useQuery({
    queryKey: ['bt-bot-performance'],
    queryFn: () => apiGet('/api/trading/bot-performance').catch(() => null),
    staleTime: 60_000,
  });
  // The SCORING OUTPUT of the most recent run (owner direction, 2026-10-26). The same query keys the
  // B panel uses, so React Query serves both from one fetch rather than asking the API twice.
  const runsList = useQuery({
    queryKey: ['bt-runs'],
    queryFn: () => apiGet('/api/backtest/runs?limit=1').catch(() => null),
    staleTime: 15_000,
  });
  const latestId = (() => {
    const raw = runsList.data;
    if (!raw) return null;
    const runs = Array.isArray(raw) ? raw : (raw.runs ?? []);
    return runs[0]?.id ?? null;
  })();
  const latestRun = useQuery({
    queryKey: ['bt-run-detail', latestId],
    queryFn: () => apiGet(`/api/backtest/results/${latestId}`).catch(() => null),
    enabled: Boolean(latestId),
    staleTime: 30_000,
  });
  const scoreSeries = latestRun.data?.scoreSeries ?? null;

  if (!botId) {
    return (
      <div className="bt-ab-panel">
        <p className="pb-none">
          Live performance is measured per BOT. Choose a Complete Strategy in step 1 — a protocol
          has no live trades to report, which is exactly why it is the other subject.
        </p>
        <ScoringOutput
          latestId={latestId}
          scoreSeries={scoreSeries}
          protocolId={latestRun.data?.protocolId ?? null}
        />
      </div>
    );
  }
  if (q.isLoading) return <p className="pb-none">Loading the bot&rsquo;s realised trades…</p>;
  const data = q.data;
  if (!data) {
    return (
      <p className="pb-none">
        ⚠️ The performance endpoint did not answer, so this is <strong>unknown</strong> — not
        &ldquo;no trades&rdquo;. Retry before concluding anything from the absence.
      </p>
    );
  }

  const bot = (data.bots ?? []).find((b) => b.botId === botId);
  if (!bot) {
    return (
      <div className="bt-ab-panel">
        <p className="pb-none">
          No realised record for <strong>{botName || botId}</strong> — it has either never traded or
          its trades are not attributed to it. A backtest (B) is then the only evidence available.
        </p>
        <ScoringOutput
          latestId={latestId}
          scoreSeries={scoreSeries}
          protocolId={latestRun.data?.protocolId ?? null}
        />
      </div>
    );
  }

  const d = bot.declared ?? {};
  const r = bot.realised ?? {};
  return (
    <div className="bt-ab-panel">
      <h3 className="pb-info-head">A · Current performance — {bot.botName}</h3>
      <p className="pb-field-note">
        LIVE, realised trades attributed to this bot — not a simulation. Population:{' '}
        <strong>{r.samples ?? 0} closed trade(s)</strong>
        {/* ⚠️ `bot.window` IS AN OBJECT ({firstClose, lastClose, days, samplesPerDay}), not a
            string — rendering it directly throws "Objects are not valid as a React child" and took
            the whole page down when this panel first mounted (2026-10-26). */}
        {bot.window?.days ? <> over {bot.window.days} day(s)</> : null}
        {r.reliability ? <> · reliability <strong>{r.reliability}</strong></> : null}.
      </p>

      <table className="bt-table">
        <caption className="sr-only">Declared settings and realised outcomes for this bot</caption>
        <thead>
          <tr>
            <th scope="col">Declared</th>
            <th scope="col">Value</th>
            <th scope="col">Realised</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Protocol</td><td>{d.protocolId ?? '—'}</td><td>Win rate</td><td>{pct(r.winRate)}</td></tr>
          <tr><td>Symbol / timeframe</td><td>{d.symbol ?? '—'} · {d.timeframe ?? '—'}</td><td>Expectancy</td><td>{money(r.expectancy)}</td></tr>
          <tr><td>Stop / target</td><td>{d.slPct ?? '—'}% / {d.tpPct ?? '—'}%</td><td>Payoff</td><td>{num(r.payoff)}</td></tr>
          <tr><td>Mode / active</td><td>{d.mode ?? '—'} · {d.active ? 'active' : 'paused'}</td><td>Total P&amp;L</td><td>{money(r.totalPnl)}</td></tr>
          <tr><td>Max positions</td><td>{d.maxPositions ?? '—'}</td><td>Profit factor</td><td>{num(r.profitFactor)}</td></tr>
          <tr><td>Entry size</td><td>{baseSize ?? d.allocationAmount ?? '—'} <span className="pb-field-gloss">lots</span></td><td>Best / worst</td><td>{money(r.bestTrade)} / {money(r.worstTrade)}</td></tr>
        </tbody>
      </table>

      {data.populationNote && <p className="pb-field-note">{data.populationNote}</p>}

      {/* ── THE SCORING OUTPUT (owner direction, 2026-10-26) ────────────────────────────────────
          *"Current performance (A) should show the scoring data generated by clicking Run and it
          needs to be captured for comparison."*
          Every bar the engine scored, read back from the run's STORED `scoresJson` — not re-computed
          here, because a panel that re-scores would be a second scoring path by definition. */}
      <ScoringOutput
        latestId={latestId}
        scoreSeries={scoreSeries}
        protocolId={latestRun.data?.protocolId ?? null}
      />

      <p className="pb-field-note">
        ⚠️ A is <strong>real trades</strong>; B is a <strong>simulation</strong>. They are two
        different measurements and this panel deliberately does not subtract one from the other —
        compare the direction and the shape, not the digits.
      </p>
    </div>
  );
}

/** B — the most recent stored backtest, with what it changed from the bot's own settings. */
export function LatestBacktestPanel({ fallbackRunId }) {
  const list = useQuery({
    queryKey: ['bt-runs'],
    queryFn: () => apiGet('/api/backtest/runs?limit=1').catch(() => null),
    staleTime: 15_000,
  });

  const latest = (() => {
    const raw = list.data;
    if (!raw) return fallbackRunId || null;
    const runs = Array.isArray(raw) ? raw : (raw.runs ?? []);
    return runs[0]?.id ?? fallbackRunId ?? null;
  })();

  const detail = useQuery({
    queryKey: ['bt-run-detail', latest],
    queryFn: () => apiGet(`/api/backtest/results/${latest}`).catch(() => null),
    enabled: Boolean(latest),
    staleTime: 30_000,
  });

  const logs = useQuery({
    queryKey: ['bt-log-tail'],
    queryFn: () => apiGet('/api/system/logs/file?lines=600').catch(() => null),
    enabled: Boolean(latest),
    staleTime: 30_000,
  });

  if (!latest) {
    return <p className="pb-none">No backtest has been stored yet, so there is nothing in B to compare against A.</p>;
  }
  if (detail.isLoading) return <p className="pb-none">Loading the most recent run…</p>;
  const run = detail.data;
  if (!run) {
    return <p className="pb-none">⚠️ The stored run could not be read — that is unknown, not empty.</p>;
  }

  const stats = run.stats ?? {};
  const ex = run.execution ?? {};
  const overridden = run.drivenBy?.overridden ?? null;
  const needle = [run.symbol, run.protocolId].filter(Boolean);
  const logLines = (logs.data?.content ?? '')
    .split('\n')
    .filter((l) => needle.some((n) => l.includes(n)))
    .slice(-40);

  return (
    <div className="bt-ab-panel">
      <h3 className="pb-info-head">B · Backtesting results — most recent stored run</h3>
      <p className="pb-field-note">
        Simulation over a window you chose. Run <code>{String(run.id).slice(0, 8)}</code>
        {run.period ? <> · {run.period}</> : null}
        {run.measuredPeriod ? <> · {run.measuredPeriod.name}</> : null}.
      </p>

      <table className="bt-table">
        <caption className="sr-only">The most recent run, as stored</caption>
        <thead>
          <tr>
            <th scope="col">Figure</th>
            <th scope="col">Value</th>
            <th scope="col">Figure</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Symbol · timeframe</td><td>{run.symbol ?? '—'} · {run.timeframe ?? '—'}</td><td>Trades</td><td>{stats.totalTrades ?? 0}</td></tr>
          <tr><td>Protocol</td><td>{run.protocolId ?? '—'}</td><td>Trade win rate</td><td>{stats.tradeWinRate == null ? '—' : `${(Number(stats.tradeWinRate) * 100).toFixed(1)}%`}</td></tr>
          <tr><td>Position model</td><td>{ex.positionModel ?? '—'}</td><td>Avg trade P&amp;L</td><td>{stats.avgTradePnl == null ? '—' : `${stats.avgTradePnl}%`}</td></tr>
          <tr><td>Spread / slippage</td><td>{ex.spread ?? '—'} / {ex.slippage ?? '—'}</td><td>Total P&amp;L</td><td>{money(stats.totalPnl)}</td></tr>
          <tr><td>Account / risk</td><td>{ex.accountSize ?? '—'} · {ex.riskPct ?? '—'}%</td><td>Max drawdown</td><td>{stats.maxDrawdown10d ?? '—'}</td></tr>
        </tbody>
      </table>

      <p className="pb-field-note">
        <strong>What this run changed from the bot:</strong>{' '}
        {overridden === null
          ? 'this run was not driven by a bot, so there is no bot settings set to differ from.'
          : overridden.length === 0
            ? 'nothing — it measured the bot exactly as configured.'
            : overridden.join(', ')}
      </p>

      {Array.isArray(run.caveats) && run.caveats.length > 0 && (
        <ul className="pb-info-list">
          {run.caveats.map((c, i) => (
            <li key={i} className="pb-info-row pb-info-row--warn"><p className="pb-info-note">{c}</p></li>
          ))}
        </ul>
      )}

      <h4 className="pb-info-head">Log lines mentioning this run</h4>
      {logLines.length === 0 ? (
        <p className="pb-none">
          No log line in the current file mentions {needle.join(' or ')}. The log holds today&rsquo;s
          entries only — an older run&rsquo;s lines are in their own dated file.
        </p>
      ) : (
        <pre className="bt-log-tail">{logLines.join('\n')}</pre>
      )}
    </div>
  );
}
