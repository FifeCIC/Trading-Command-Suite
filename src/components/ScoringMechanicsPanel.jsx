/**
 * ScoringMechanicsPanel — the scoring maths, broken down, on live numbers.
 *
 * Owner request (Page Walkthrough, `/trading/trading-bots`): *"I dont trust our approach to generating
 * that score... The whole thing needs re-examined. Lets create a UI for the scoring mechanism - wire
 * all of it to a view that merges diagram with a dynamic page. We will do this with every approach to
 * scoring so that the maths is broken down and it makes it easier for me to understand."*
 *
 * ⚠️ IT SHOWS THE REAL NUMBERS, NOT A DESCRIPTION OF THEM. Every figure below comes from
 * `POST /api/scoring/gated/batch` for the selected symbol+protocol. A panel that explained the formula
 * in prose would be a second source of truth for the maths, and it would drift the moment the maths
 * changed — which is exactly what the reader is here to check.
 *
 * ⚠️ THE FIELD NAMES ARE LOAD-BEARING AND WERE MEASURED (2026-10-08), not guessed:
 *   composite          — equals `signalRaw`; this is the number the bot's threshold compares against
 *   signalRaw/signalMax — the raw signal over the protocol's REAL maximum (910 for xau-speed-v1)
 *   signalPct           — the percentage, and it AGREES with raw/max
 *   subRawTotals/subMaxTotals — per-group raw and max, the group-percentage step
 *   riskMultiplier      — applied to the composite
 *   opportunityScore/Max/Pct — a SEPARATE additive screen, not part of the signal
 *
 * ⚠️ WHY IT SAYS "NOT OUT OF 100". #1090 measured the ranked endpoint reporting
 * `maxPossibleScore: 100` for every row while the protocol declares 1010 and the raw score exceeds
 * 100 — so a score shown as "n/100" is a number against a denominator the protocol does not have.
 * This panel shows raw/max instead, and never prints "/100" for a composite.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiPost } from '../core/api/client';
import './scoring-mechanics.css';

const SIGNAL_STOPS = [
  { at: 80, label: 'STRONG', tone: 'strong' },
  { at: 40, label: 'TRADE', tone: 'trade' },
  { at: 20, label: 'HOLD', tone: 'hold' },
];

/** A raw/max pair rendered as a number AND its percentage, because the percentage is the readable bit
 *  and the raw pair is the evidence for it. */
function Ratio({ label, raw, max, note }) {
  const pct = max ? (raw / max) * 100 : null;
  return (
    <div className="sm-ratio">
      <span className="sm-ratio-label">{label}</span>
      <span className="sm-ratio-value">
        {raw ?? '—'} <span className="sm-ratio-max">/ {max ?? '—'}</span>
      </span>
      <span className="sm-ratio-pct">{pct != null ? `${pct.toFixed(2)}%` : '—'}</span>
      {note && <span className="sm-ratio-note">{note}</span>}
    </div>
  );
}

export default function ScoringMechanicsPanel({ strategies = [] }) {
  // Candidate pairs come from the strategies that exist — a bot is a protocol bound to a symbol, so
  // it is the natural source. Falls back to the first available pair.
  const pairs = strategies
    .filter((s) => s.protocolId && s.symbol)
    // ⚠️ NO ORDERING HEURISTIC HERE, DELIBERATELY. An earlier version sorted `-copy` protocols last,
    // on the theory that a copy has no protocol behind it and so scores NO_DATA. Measured 2026-10-08
    // and FALSE: `xau-speed-m5-copy` returns a real score (signalMax 910), while `dow-speed-v1` — not
    // a copy at all — returns NO_DATA. Data availability, not the name, decides it, and a heuristic
    // that cannot be justified is a silent lie in the default the reader sees first.
    .map((s) => ({ key: `${s.protocolId}|${s.symbol}`, protocolId: s.protocolId, symbol: s.symbol, name: s.name }));
  const [pairKey, setPairKey] = useState(null);
  const active = pairs.find((p) => p.key === pairKey) || pairs[0] || null;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['scoring-mechanics', active?.protocolId, active?.symbol],
    queryFn: async () => {
      const r = await apiPost('/api/scoring/gated/batch', {
        tickers: [active.symbol],
        protocolId: active.protocolId,
      });
      return Array.isArray(r) ? r[0] : r;
    },
    enabled: !!active,
    staleTime: 15_000,
  });

  if (pairs.length === 0) {
    return (
      <section className="sm-panel">
        <h2 className="sm-title">Scoring mechanics</h2>
        <p className="sm-note">
          No bot currently binds a protocol to a symbol, so there is nothing to break down here. Create
          one above and this panel will show its maths.
        </p>
      </section>
    );
  }

  const groups = Object.keys(data?.subRawTotals || {});
  const compositePct = data && data.signalMax ? (data.signalRaw / data.signalMax) * 100 : null;

  return (
    <section className="sm-panel">
      <header className="sm-head">
        <h2 className="sm-title">Scoring mechanics</h2>
        <span className="sm-sub">The maths behind the Score column — live numbers, not a description</span>
        <label className="sm-picker">
          <span className="sm-picker-label">Bot</span>
          <select
            className="ff-input"
            value={active?.key || ''}
            onChange={(e) => setPairKey(e.target.value)}
            aria-label="Which bot's scoring to break down"
          >
            {pairs.map((p) => (
              <option key={p.key} value={p.key}>{p.name || p.key} — {p.symbol}</option>
            ))}
          </select>
        </label>
      </header>

      {isLoading && <p className="sm-note">Scoring {active?.symbol} with {active?.protocolId}…</p>}
      {isError && (
        <p className="sm-note sm-error" role="alert">
          The score could not be computed: {error?.detail || error?.message || 'the request failed'}.
        </p>
      )}

      {data && (
        <>
          {/* ── The chain, in order, with the real figures at each step ── */}
          <ol className="sm-chain">
            <li>
              <span className="sm-step">1 · Directives score</span>
              <span className="sm-step-note">
                Each active directive returns a raw score out of its own maxScore. Muted or gated
                directives return 0.
              </span>
              <div className="sm-groups">
                {groups.map((g) => (
                  <Ratio
                    key={g}
                    label={g}
                    raw={data.subRawTotals?.[g]}
                    max={data.subMaxTotals?.[g]}
                  />
                ))}
                {groups.length === 0 && <span className="sm-note">No group totals were returned.</span>}
              </div>
            </li>

            <li>
              <span className="sm-step">2 · Group percentage</span>
              <span className="sm-step-note">
                sum(raw) ÷ sum(max) per group — that is what a group score IS. It is a percentage, not a
                count of directives.
              </span>
            </li>

            <li>
              <span className="sm-step">3 · Composite</span>
              <div className="sm-groups">
                <Ratio label="signal" raw={data.signalRaw} max={data.signalMax} note="the raw composite" />
                <Ratio label="opportunity" raw={data.opportunityScore} max={data.opportunityMax} note="a separate additive screen — not part of the signal" />
              </div>
              {/* ⚠️ THE ZERO-MAX CASE IS ITS OWN STATE (measured 2026-10-08). Printing "0 out of a
                  maximum of 0" states a ratio that does not exist — the failure the owner is here to
                  catch. When there is no maximum there is no maths to show, and the panel says so. */}
              {data.signalMax ? (
                <p className="sm-verdict">
                  The <strong>Score</strong> column shows the raw composite — <strong>{data.signalRaw}</strong>{' '}
                  out of this protocol&rsquo;s maximum of <strong>{data.signalMax}</strong>
                  {compositePct != null && <> (<strong>{compositePct.toFixed(2)}%</strong> of capacity)</>}.
                  It is <strong>not</strong> a score out of 100.
                </p>
              ) : (
                <p className="sm-verdict sm-error" role="status">
                  No score came back for this pair — the composite is {data.signalRaw ?? 0} and the
                  protocol&rsquo;s maximum is {data.signalMax ?? 0}, so there are no figures to show.
                  {' '}⚠️ <strong>This response does not say why</strong>, and the panel will not guess: it
                  cannot distinguish a protocol with no definition from a symbol with no fresh bars, and
                  those need different fixes. Switch bot above — a pair that scores will fill every step.
                  The <strong>opportunity</strong> figure is computed separately and is still real.
                </p>
              )}
            </li>

            <li>
              <span className="sm-step">4 · Risk multiplier</span>
              <span className="sm-step-note">
                Applied to the composite. Hard gates can veto outright; soft modifiers scale it.
              </span>
              <div className="sm-groups">
                <Ratio label="risk" raw={data.riskMultiplier} max={null} note="multiplier, not a score" />
              </div>
              {Array.isArray(data.riskGate?.chain) && data.riskGate.chain.length > 0 && (
                <ul className="sm-chainlist">
                  {data.riskGate.chain.map((c, i) => (
                    <li key={i}>
                      <span className="sm-chip">{c.rule}</span>
                      <span className="sm-ratio-pct">×{c.multiplier}</span>
                      <span className="sm-ratio-note">severity {c.severity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            <li>
              <span className="sm-step">5 · Signal classification</span>
              <span className="sm-step-note">
                The SIGNAL is a separate decision from the composite — it comes from the percentage,
                not from the raw number.
              </span>
              <div className="sm-stops" role="img" aria-label={`Signal scale, currently ${data.signal}`}>
                {SIGNAL_STOPS.map((s) => (
                  <span key={s.at} className={`sm-stop sm-stop--${s.tone}`}>
                    <span className="sm-stop-at">{s.at}</span>
                    <span className="sm-stop-label">{s.label}</span>
                  </span>
                ))}
                {data.signalPct != null && (
                  <span
                    className="sm-stop-marker"
                    style={{ left: `${Math.min(100, Math.max(0, Number(data.signalPct)))}%` }}
                    title={`This symbol: ${Number(data.signalPct).toFixed(2)}%`}
                  />
                )}
              </div>
              <p className="sm-verdict">
                Now: <strong>{data.signal}</strong>
                {data.signalPct != null && <> at <strong>{Number(data.signalPct).toFixed(2)}%</strong></>}
                {data.directionMode && <> · this protocol may emit <strong>{data.directionMode}</strong></>}
              </p>
            </li>
          </ol>

          <p className="sm-foot">
            Every figure above is one live scoring call for {data.symbol} against{' '}
            <code>{active?.protocolId}</code>. Re-run it by switching bot or refreshing the page.
          </p>
        </>
      )}
    </section>
  );
}
