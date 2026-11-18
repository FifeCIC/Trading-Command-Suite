/**
 * ThresholdRangeMap — the NUMBERS map, not the steps map (#1275).
 * ==============================================================
 *
 * Owner directive, 2026-11-14: I wanted all steps, all possible decisions, to be clearly mapped in the
 * Diagrams page and architecture documentation: the idea is to form the connections that clarify an
 * algorithm essentially.
 *
 * ⚠️ WHY THIS IS NOT A FLOWCHART, AND WHY THAT MATTERS.
 * The Diagrams page already draws every step and every branch of the pipeline — including the gate
 * this control is about:
 *
 *     RANK --> G1{"composite < minComposite?"}
 *     G1 -->|yes| SKIP1["SKIP"]
 *
 * The route was correct and an agent tracing it start-to-finish would pass it. The defect nobody
 * could see was a property of the NUMBER travelling down that route: a `minComposite` at or below
 * the score a protocol emits when nothing is happening. Flow diagrams answer "where does it go";
 * this answers "is the number it carries legal". Those are different pictures and a missing one of
 * them is not a missing step.
 *
 * ⚠️ NOTHING HERE IS TYPED. Every floor and ceiling is measured from `score_snapshot` by
 * `GET /api/scoring/gated/thresholds`; a hardcoded band would be a claim that goes stale the moment
 * a weighting changes — the exact failure mode this control exists to expose.
 *
 * ⚠️ THREE STATES, NEVER TWO, per row and per protocol:
 *   ✅ in range · 🛑 out of range · ⚠️ cannot judge
 * A protocol with no readings is NOT "in range". Collapsing those two is how six bots stayed
 * invisible (measured 2026-11-14; the same run at a 7-day window found 21).
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

const fmt = (v, digits = 2) => (v == null ? '—' : Number(v).toFixed(digits));

export default function ThresholdRangeMap() {
  const q = useQuery({
    queryKey: ['threshold-range-map'],
    queryFn: () => apiGet('/api/scoring/gated/thresholds').catch(() => null),
    staleTime: 60_000,
  });

  if (q.isLoading) {
    return <p className="dg-range-note">Measuring each protocol&apos;s band…</p>;
  }
  // ⚠️ A failed query must not render as an empty table. "cannot judge" is said out loud.
  if (!q.data) {
    return (
      <p className="dg-range-note dg-range-note--warn">
        ⚠️ The band could not be measured, so this map is <strong>unknown</strong> — not empty and not
        &quot;all in range&quot;. Nothing has been checked.
      </p>
    );
  }

  const bots = (q.data.bots ?? []).filter((b) => b.active);
  const outOfRange = bots.filter((b) => b.aboveFloor === 'no');
  const cannotJudge = bots.filter((b) => b.aboveFloor === 'no-data');
  const inRange = bots.filter((b) => b.aboveFloor === 'yes');

  // One row per protocol, so a protocol shared by thirteen bots is explained once.
  const byProtocol = new Map();
  for (const b of bots) {
    const list = byProtocol.get(b.protocolId) ?? [];
    list.push(b);
    byProtocol.set(b.protocolId, list);
  }
  const bands = q.data.protocolBands ?? {};

  return (
    <section className="dg-range" aria-labelledby="range-map-heading">
      <h3 id="range-map-heading" className="dg-range-head">
        Threshold range map — every configurable entry bar against its measured band
      </h3>
      <p className="dg-range-note">
        Measured from <code>score_snapshot</code> over {q.data.windowDays} day(s), after the scale
        epoch. <strong>Floor</strong> is the score the protocol emits most often — its &quot;nothing is
        happening&quot; state, which is not zero. <strong>Ceiling</strong> is the most it has ever
        reached. A bar is legal only strictly <em>above</em> the floor and at or below the ceiling.
      </p>
      <p className="dg-range-note">
        {q.data.bandRule?.why}
      </p>

      <div className="dg-range-tally" role="status">
        <span className="dg-range-chip dg-range-chip--ok">{inRange.length} in range</span>
        <span className="dg-range-chip dg-range-chip--bad">{outOfRange.length} out of range</span>
        <span className="dg-range-chip dg-range-chip--unknown">{cannotJudge.length} cannot judge</span>
      </div>

      <table className="dg-range-table">
        <caption className="sr-only">
          Each active bot&apos;s entry bar, its protocol&apos;s measured floor and ceiling, and the verdict
        </caption>
        <thead>
          <tr>
            <th scope="col">Bot</th>
            <th scope="col">Protocol</th>
            <th scope="col">Bar</th>
            <th scope="col">Floor</th>
            <th scope="col">Ceiling</th>
            <th scope="col">Floor basis</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {[...byProtocol.entries()].map(([protocolId, list]) => {
            const band = bands[protocolId] ?? null;
            return list.map((b, i) => {
              const verdict = b.aboveFloor === 'yes'
                ? { cls: 'ok', text: '✅ in range' }
                : b.aboveFloor === 'no'
                  ? { cls: 'bad', text: '🛑 at or below the floor' }
                  : { cls: 'unknown', text: '⚠️ cannot judge' };
              return (
                <tr key={`${protocolId}-${b.name}`} className={`dg-range-row dg-range-row--${verdict.cls}`}>
                  <th scope="row">{b.name}</th>
                  <td>
                    {i === 0 ? (
                      <>
                        <code>{protocolId}</code>
                        {band?.verdict && band.verdict !== 'measured' ? (
                          <span className="dg-range-sub"> · {band.verdict}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="dg-range-sub">↳ same protocol</span>
                    )}
                  </td>
                  <td className="dg-range-num">{fmt(b.thresholdPct, 2)}%</td>
                  <td className="dg-range-num">{fmt(b.floorPct, 2)}%</td>
                  <td className="dg-range-num">{fmt(band?.ceilingPct, 2)}%</td>
                  <td>
                    {band?.floorPct == null ? (
                      <span className="dg-range-sub">
                        not measured — {band?.samples ?? 0} reading(s)
                      </span>
                    ) : (
                      <span className="dg-range-sub">
                        {fmt(band.floorSharePct, 1)}% of {band.samples} readings ·{' '}
                        {band.distinctValues} distinct value(s)
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`dg-range-badge dg-range-badge--${verdict.cls}`}>{verdict.text}</span>
                    {b.aboveFloor === 'no' ? (
                      <span className="dg-range-sub">
                        {' '}
                        trades the no-signal state on every bar
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>

      <p className="dg-range-note">
        ⚠️ <strong>A below-floor bar is a live trading configuration, not a build error.</strong> The
        guard (<code>npm run audit:threshold-range</code>) reports it and exits 0;{' '}
        <code>--strict</code> makes it fail. Whether a bot should stop is a decision, not a lint rule.
      </p>
    </section>
  );
}
