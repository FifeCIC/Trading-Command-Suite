import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
// ⚠️ ERRORS COME FROM THE REGISTRY, NOT FROM PROSE (#826). A code is the stable identity of a
// message; the wording may change and the code must not. Hand-written error text also loses
// everything structured about the failure.
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import { notice } from '../core/notices/registry.js';
import './stop-guardian-stats.css';

/**
 * StopGuardianStatsPage — the Stop Guardian statistics page (#988).
 * =================================================================
 * A READ-ONLY view over `stop_adjustment` (every post-entry stop move) and `sim_tsl_event`
 * (decision-moment observations from #936). Owner request, 2026-09-24:
 *
 *   > "if there is historical data for StopGuardianService I would like a page of statistics
 *   >  for Stop Guardian in the Trading area"
 *
 * ⚠️ THIS PAGE SHOWS MECHANICS, NOT A VERDICT. Correlating a tighten with P&L would compare an
 * intervention against an outcome the position would have had anyway — that needs an A/B copy
 * (`maths-change-requires-ab.instructions.md`), not a chart. So: how often, how far, from what
 * evidence, and whether the #927 floor held.
 *
 * ⚠️ TWO RENDERING RULES THAT ARE NOT COSMETIC (#988 acceptance):
 *   1. EVERY figure carries its sample size. A median over 4 rows and a median over 452 rows are
 *      different claims, and the page must not let them look the same.
 *   2. A FAILED READ RENDERS AS A FAILURE. `ok:false` shows an error banner, never an empty chart —
 *      "we could not read this" and "there is nothing here" are different statements, and an empty
 *      chart would assert the second while meaning the first.
 */

/** Absent is `—`, never `0`. Zero is a measurement; absence is the lack of one. */
function num(v, digits = 2) {
  if (v === null || v === undefined || typeof v !== 'number' || Number.isNaN(v)) return '—';
  return v.toFixed(digits);
}

function int(v) {
  if (v === null || v === undefined || typeof v !== 'number' || Number.isNaN(v)) return '—';
  return String(v);
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** A figure with its own sample size — the page's one non-negotiable convention. */
function Fig({ label, value, n, suffix }) {
  return (
    <div className="sg-fig">
      <span className="sg-fig-value">{value}{suffix && value !== '—' ? suffix : ''}</span>
      <span className="sg-fig-label">{label}</span>
      <span className="sg-fig-n">n = {int(n)}</span>
    </div>
  );
}

export default function StopGuardianStatsPage() {
  const [symbol, setSymbol] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Symbol options come from the UNFILTERED set, so choosing one never empties the list.
  const symbolsQuery = useQuery({
    queryKey: ['sg-stats', 'symbols'],
    queryFn: () => apiGet('/api/trading/stop-guardian-stats').catch(() => null),
    staleTime: 300_000,
  });

  const params = new URLSearchParams();
  if (symbol) params.set('symbol', symbol);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  const statsQuery = useQuery({
    queryKey: ['sg-stats', qs],
    // No `.catch` — a thrown failure must reach react-query as a real error so it can be rendered
    // THROUGH the notice registry. Swallowing it into `{ok:false}` would hide which failure it was.
    queryFn: () => apiGet(`/api/trading/stop-guardian-stats${qs ? `?${qs}` : ''}`),
    staleTime: 30_000,
  });

  const data = statsQuery.data;
  const symbolOptions = useMemo(
    () => (symbolsQuery.data?.frequency?.perSymbol ?? []).map((r) => r.symbol),
    [symbolsQuery.data],
  );

  if (statsQuery.isLoading) {
    return <div className="sg-page"><p className="sg-muted">Reading the guardian history…</p></div>;
  }

  // ⚠️ Rule 2: a failed read is a FAILURE, not an empty page. Two distinct causes, two codes:
  //   · nothing came back at all  → the transport code, with the operation named
  //   · the server answered `ok:false` → the server's own reason is kept as the detail
  const failure = statsQuery.error
    ? noticeFromError(statsQuery.error, 'TCS-SYS-007', { operation: 'read the guardian history' })
    : data?.ok === false
      ? notice('TCS-SYS-009', { detail: data.error ?? 'the server reported that the read failed' })
      : null;

  if (!data || failure) {
    return (
      <div className="sg-page">
        <header className="sg-header">
          <h2>Stop Guardian</h2>
        </header>
        <div className="sg-error" role="alert">
          <NoticeBlock notice={failure} />
          <p className="sg-muted">
            This is a FAILED READ, not an empty history — the guardian may have adjusted stops that
            cannot be shown here. Retry, and if it persists check the API and the database.
          </p>
        </div>
      </div>
    );
  }

  const { sample, frequency, distance, consensus, floor, simTsl } = data;
  const a = distance.achievedPct;

  return (
    <div className="sg-page">
      <header className="sg-header">
        <h2>Stop Guardian</h2>
        <p className="sg-sub">
          Post-entry stop management, from the audit trail it already writes (<code>stop_adjustment</code>).
          Mechanics only — how often it acts, how far it moves a stop, on what evidence, and whether the
          declared-distance floor held. <strong>No profitability claim:</strong> that needs an A/B copy.
        </p>
      </header>

      <div className="sg-filters">
        <label>
          Symbol
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            <option value="">All symbols</option>
            {symbolOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(symbol || from || to) && (
          <button type="button" onClick={() => { setSymbol(''); setFrom(''); setTo(''); }}>Clear</button>
        )}
      </div>

      {/* ── 1. the sample, stated before any figure is read ── */}
      <section className="sg-section">
        <h3>Sample <span className="sg-hint">what every figure below is computed from</span></h3>
        <div className="sg-figs">
          <Fig label="adjustments recorded" value={int(sample.adjustments)} n={sample.adjustments} />
          <Fig label="distinct symbols" value={int(sample.symbols)} n={sample.adjustments} />
          <Fig label="distinct positions" value={int(sample.positions)} n={sample.adjustments} />
          <Fig label="carry a dist= figure" value={int(sample.withDistance)} n={sample.adjustments} />
        </div>
        <p className="sg-muted">
          Window: {fmtTime(sample.firstAt)} → {fmtTime(sample.lastAt)}
          {sample.withoutDistance > 0 && (
            <> · <strong>{sample.withoutDistance}</strong> adjustment(s) carry no <code>dist=</code> figure
            and are excluded from the distance statistics — not counted as zero.</>
          )}
        </p>
      </section>

      {/* ── 2. how often ── */}
      <section className="sg-section">
        <h3>How often it acts <span className="sg-hint">per symbol, per UTC hour, per day</span></h3>
        <div className="sg-cols">
          <div>
            <h4>By symbol</h4>
            {frequency.perSymbol.length === 0 ? <p className="sg-muted">—</p> : (
              <table className="sg-table">
                <thead><tr><th>Symbol</th><th className="sg-right">Adjustments</th></tr></thead>
                <tbody>
                  {frequency.perSymbol.map((r) => (
                    <tr key={r.symbol}><td>{r.symbol}</td><td className="sg-right sg-num">{r.count}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h4>By UTC hour</h4>
            <div className="sg-hours">
              {frequency.perHourUtc.map((h) => (
                <div key={h.hour} className="sg-hour" title={`${h.hour}:00 UTC — ${h.count} adjustment(s)`}>
                  <span className="sg-hour-bar" style={{ height: `${Math.min(100, h.count * 6)}%` }} />
                  <span className="sg-hour-n">{h.count || ''}</span>
                  <span className="sg-hour-l">{String(h.hour).padStart(2, '0')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. how far ── */}
      <section className="sg-section">
        <h3>How far it moves a stop <span className="sg-hint">achieved trail distance, from each reason string</span></h3>
        <div className="sg-figs">
          <Fig label="achieved dist — min" value={num(a.min, 3)} n={a.n} suffix="%" />
          <Fig label="p25" value={num(a.p25, 3)} n={a.n} suffix="%" />
          <Fig label="median" value={num(a.median, 3)} n={a.n} suffix="%" />
          <Fig label="p75" value={num(a.p75, 3)} n={a.n} suffix="%" />
          <Fig label="max" value={num(a.max, 3)} n={a.n} suffix="%" />
          <Fig label="mean" value={num(a.mean, 3)} n={a.n} suffix="%" />
        </div>
        <p className="sg-muted">
          Direction of travel: <strong>{int(distance.tighten)}</strong> tightened,{' '}
          <strong>{int(distance.restore)}</strong> RESTORED to the declared distance,{' '}
          <strong>{int(distance.loosen)}</strong> loosened,{' '}
          <strong>{int(distance.unchanged)}</strong> unchanged — n = {int(sample.adjustments)}.
          <br />
          ⚠️ The guardian only ever <em>tightens</em>, so a downward move is not what the mechanism is
          supposed to do. It is also not automatically a fault: the <code>#927</code> repair moves a
          stop back OUT to the declared distance and marks its reason <code>RESTORE #927</code>, which
          is why those rows are counted separately instead of as loosening. A non-zero{' '}
          <strong>loosened</strong> figure is the one worth looking at.
        </p>
      </section>

      {/* ── 4. the #927 floor — the check this repo cares about ── */}
      <section className="sg-section">
        <h3>
          Declared-distance floor (#927){' '}
          <span className="sg-hint">achieved <code>dist%</code> vs the position&rsquo;s own <code>slPct</code></span>
        </h3>
        {floor.checked === 0 ? (
          <p className="sg-muted">
            No adjustment could be matched to a bot, so the floor cannot be checked here — <strong>this is
            missing coverage, not a pass.</strong> Attribution runs through <code>trade.strategy</code>,
            which is NULL on many rows (#949).
          </p>
        ) : (
          <>
            <div className="sg-figs">
              <Fig label="floor checks possible" value={int(floor.checked)} n={floor.checked} />
              <Fig label="INSIDE the declared distance" value={int(floor.violations)} n={floor.checked} />
            </div>
            <p className="sg-muted">
              The invariant says a tighten may never leave the stop closer to price than the position&rsquo;s
              declared distance. {floor.violations === 0
                ? 'No breach found in the rows that could be checked.'
                : `${floor.violations} row(s) are inside the floor — those are real, and the sample is the ${floor.checked} rows above.`}
              <br />
              ⚠️ A difference smaller than <strong>{floor.tolerancePct}</strong> percentage points is
              treated as rounding, not a breach: <code>dist=</code> is recorded to 3 decimal places
              while <code>slPct</code> is stored to 1, so a declared <code>1%</code> is routinely
              logged as <code>0.999%</code>. Without that band this check reported 193 breaches where
              there were none. The real #927 defect trailed a stop to <code>0.039%</code> against a
              declared <code>1%</code> — a genuine breach is large.
              <br />
              <strong>Read the dates.</strong> The floor was added on <strong>2026-09-21 19:13</strong>,
              so a breach before that date is the defect the floor was built for. A breach{' '}
              <em>after</em> it is a live failure. Measured 2026-09-25: 119 breaches pre-date the fix
              and <strong>18 land on 2026-09-23</strong>, i.e. the floor did not hold on that day.
            </p>
            <table className="sg-table">
              <thead>
                <tr><th>Symbol</th><th className="sg-right">Declared</th><th className="sg-right">Achieved</th><th>Floor</th><th>When</th></tr>
              </thead>
              <tbody>
                {floor.rows.slice(0, 15).map((r, i) => (
                  <tr key={`${r.symbol}-${i}`}>
                    <td>{r.symbol}</td>
                    <td className="sg-right sg-num">{num(r.declaredPct, 3)}%</td>
                    <td className="sg-right sg-num">{num(r.achievedPct, 3)}%</td>
                    <td className={r.insideFloor ? 'sg-bad' : 'sg-ok'}>
                      {r.insideFloor ? 'INSIDE' : 'respects'}
                    </td>
                    <td className="sg-muted">{fmtTime(r.adjustedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* ── 5. which directives drove it ── */}
      <section className="sg-section">
        <h3>What drove the decision <span className="sg-hint">consensus + the four directive votes</span></h3>
        <div className="sg-figs">
          <Fig label="consensus readable" value={int(consensus.readable)} n={sample.adjustments} />
          <Fig label="reached the ≥ 55 gate" value={int(consensus.reached)} n={consensus.readable} />
        </div>
        <div className="sg-cols">
          <div>
            <h4>Directive votes</h4>
            {consensus.byDirective.length === 0 ? <p className="sg-muted">— no directive scores recorded</p> : (
              <table className="sg-table">
                <thead><tr><th>Directive</th><th className="sg-right">Votes</th><th className="sg-right">Avg score</th></tr></thead>
                <tbody>
                  {consensus.byDirective.map((d) => (
                    <tr key={d.key}>
                      <td className="sg-mono">{d.key}</td>
                      <td className="sg-right sg-num">{d.votes}</td>
                      <td className="sg-right sg-num">{num(d.avgScore, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="sg-muted">
              Votes are counted from each row&rsquo;s recorded <code>directiveScores</code>, so they are the
              guardian&rsquo;s own evidence — n = {int(sample.adjustments)}.
            </p>
          </div>
          <div>
            <h4>Consensus distribution</h4>
            {consensus.distribution.length === 0 ? <p className="sg-muted">—</p> : (
              <table className="sg-table">
                <thead><tr><th className="sg-right">Consensus</th><th className="sg-right">Count</th></tr></thead>
                <tbody>
                  {consensus.distribution.map((c) => (
                    <tr key={c.consensus}><td className="sg-right sg-num">{c.consensus}</td><td className="sg-right sg-num">{c.count}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {/* ── 6. sim-TSL, kept visibly separate (#936) ── */}
      <section className="sg-section">
        <h3>Simulated TSL decision points <span className="sg-hint">#936 — recorded, and NOT broker actions</span></h3>
        <div className="sg-figs">
          <Fig label="events recorded" value={int(simTsl.events)} n={simTsl.events} />
          {simTsl.byEvent.map((e) => (
            <Fig key={e.event} label={e.event} value={int(e.count)} n={simTsl.events} />
          ))}
        </div>
        <p className="sg-muted">{simTsl.note}</p>
      </section>
    </div>
  );
}
