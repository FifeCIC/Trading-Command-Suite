/**
 * ParityStep — WHAT THIS RUN CANNOT REPRODUCE OF THE LIVE ACCOUNT.
 *
 * ── WHY THIS IS ON THE PAGE AND NOT IN A DOCUMENT ────────────────────────────────────────────────
 * Owner requirement, 2026-11-24: a five-day backtest scored 4,000.94 and the question is whether it is
 * the same system as the account. The answer used to be a prose table in an issue — unreadable from the
 * page and unable to fail a build. It is now the register in `common/trading/parity-register.ts`, checked
 * against the source by `validate-parity-register.cjs` on every build, and rendered here from the same
 * data the gate reads. One source, two readers.
 *
 * ── ⚠️ A VERDICT IS A WORD, NOT A COLOUR ────────────────────────────────────────────────────────
 * `shared` / `divergent` / `population` / `model` / `gap` are printed as text, so the table survives
 * greyscale and a screen reader. Colour only reinforces.
 *
 * ── ⚠️ WHAT IT DOES **NOT** SAY ─────────────────────────────────────────────────────────────────
 * It does not adjust any number. A run's P/L is what the engine computed; this table explains what the
 * engine is, so a reader can decide how much of that figure to believe. Wiring a mechanism is a maths
 * change (register row 23) and would need a copied configuration and a comparison.
 */
import { useQuery } from '@tanstack/react-query';
import Explanation from '../../components/Explanation.jsx';
import { apiGet } from '../../core/api/client';
import NoticeBlock from '../../components/NoticeBlock.jsx';
import { noticeFromError } from '../../core/notices/from-error.js';

const VERDICT_TEXT = {
  shared: 'Shared',
  divergent: 'Different rule',
  population: 'Gated',
  model: 'Modelled',
  gap: 'Absent',
};

const VERDICT_HINT = {
  shared: 'Both paths call ONE implementation — the only form of parity that survives a later edit.',
  divergent: 'Both paths do it, by different rules: the run reproduces the mechanism and not its behaviour.',
  population: 'The engine has it behind a flag or a narrower population, so a default run differs.',
  model: 'Both have it, but one side measures and the other approximates.',
  gap: 'The engine does not do this at all, so a run cannot show it.',
};

const VERDICT_ORDER = ['gap', 'divergent', 'population', 'model', 'shared'];

export default function ParityStep({ runs }) {
  const parity = useQuery({
    queryKey: ['backtest', 'parity'],
    queryFn: () => apiGet('/api/backtest/parity'),
    staleTime: 10 * 60 * 1000,
  });

  if (parity.isPending) {
    return <p className="mvp-note">Reading the parity register…</p>;
  }
  if (parity.isError) {
    return (
      <NoticeBlock
        notice={noticeFromError(parity.error, 'TCS-SYS-002', {
          operation: 'load the backtest/live parity register',
        })}
      />
    );
  }

  const rows = Array.isArray(parity.data?.rows) ? parity.data.rows : [];
  if (rows.length === 0) {
    // An empty register is not "full parity" — it is a register that failed to load.
    return (
      <p className="mvp-note mvp-note--warn">
        The parity register returned no rows, so nothing can be said about what this run reproduces.
      </p>
    );
  }

  const summary = parity.data.summary ?? {};
  const sorted = [...rows].sort(
    (a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict),
  );

  // The LAST run carries the freshest exposure; summing would count a day's trades twice.
  const exposure = (Array.isArray(runs) ? runs : [])
    .map((r) => r?.parityExposure)
    .filter(Boolean)
    .pop() ?? null;

  return (
    <>
      {/*
        ── THIS RUN'S OWN EXPOSURE COMES FIRST (2026-11-24) ────────────────────────────────────────
        The register below answers "what IS the engine". A reader looking at a five-day total needs
        "how much of THIS result came from the mechanisms that differ" — and the two are different
        questions. Measured on 2026-11-20: 53 trades, 25 time-stop, 28 end-of-data, and the divergent
        fill mechanisms never touched. That is the sentence a total cannot say.
      */}
      {exposure && exposure.trades > 0 && (
        <>
          {/*
            ⚠️ A RUN WHOSE EVERY TRADE ENDED WITH THE DATA IS NOT A RESULT, and it must not be able to look
            like one. Measured 2026-11-24: two movers days produced 40 trades and EVERY ONE was still open
            when the series stopped — 100% of a 3,238.00 total was unrealised mark-to-market with no live
            event behind it. A 10-hour max hold on a one-session dataset means no position can reach its
            own exit. That is a fault in the RUN, so it is stated above the table, not inside a note.
          */}
          {exposure.eodShare >= 0.9 && (
            <p className="mvp-note mvp-note--warn">
              <strong>
                {Math.round(exposure.eodShare * 100)}% of this run’s trades were never closed by a decision.
              </strong>
              {' They were still open when the data ended and are marked to the last bar, so the P/L above is'}
              {' unrealised and live has no equivalent event. Treat this total as a position mark, not a result.'}
            </p>
          )}
          <Explanation summary="What this run’s exposure is">
            <strong>This run’s exposure.</strong> {exposure.note}
          </Explanation>
          <div className="mvp-scroll">
            <table className="mvp-table">
              <thead>
                <tr>
                  <th scope="col">Exit mechanism</th>
                  <th scope="col">Verdict</th>
                  <th scope="col" className="mvp-num">Trades</th>
                  <th scope="col" className="mvp-num">Share</th>
                  <th scope="col" className="mvp-num">P/L</th>
                </tr>
              </thead>
              <tbody>
                {exposure.mechanisms.map((m) => (
                  <tr key={m.mechanism}>
                    <th scope="row" className="mvp-nowrap">
                      {m.mechanism}
                      <span className="mvp-inv-label">{m.exitReason ?? '—'}</span>
                    </th>
                    <td className="mvp-nowrap">
                      <span className={`mvp-state mvp-state--${m.differs ? 'warn' : 'entry'}`}>
                        {m.verdict === 'engine-only' ? 'Engine only' : (VERDICT_TEXT[m.verdict] ?? m.verdict)}
                      </span>
                    </td>
                    <td className="mvp-num">{m.trades}</td>
                    <td className="mvp-num">{(m.tradeShare * 100).toFixed(0)}%</td>
                    <td className={`mvp-num ${m.pnl > 0 ? 'mvp-pos' : m.pnl < 0 ? 'mvp-neg' : ''}`}>
                      {m.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {exposure.unmapped.length > 0 && (
            <p className="mvp-note mvp-note--warn">
              {exposure.unmapped.length} exit reason(s) have no mechanism row:{' '}
              {exposure.unmapped.map((u) => `${u.exitReason ?? '(none)'} ×${u.trades}`).join(', ')}. They are
              counted in the total and attributed to nothing — the coverage spec should have caught this.
            </p>
          )}
        </>
      )}

      <Explanation summary="Which mechanisms live does not reproduce">
        <strong>
          {summary.outcomeGaps} of {summary.total} mechanisms that change a trade outcome are not shared
          verbatim with live.
        </strong>{' '}
        The rest of a run’s figures are computed by the engine’s own rules, so a P/L is a statement about
        the engine — not a forecast of the account.
      </Explanation>

      <div className="mvp-scroll">
        <table className="mvp-table">
          <thead>
            <tr>
              <th scope="col">Mechanism</th>
              <th scope="col">Verdict</th>
              <th scope="col">Backtest side</th>
              <th scope="col">Live side</th>
              <th scope="col">What it means</th>
              <th scope="col" className="mvp-num">Issue</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className={r.verdict === 'shared' ? '' : 'mvp-config-row--ignored'}>
                <th scope="row" className="mvp-nowrap">{r.mechanism}</th>
                <td className="mvp-nowrap" title={VERDICT_HINT[r.verdict] ?? undefined}>
                  <span className={`mvp-state mvp-state--${r.verdict === 'shared' ? 'entry' : 'warn'}`}>
                    {VERDICT_TEXT[r.verdict] ?? r.verdict}
                  </span>
                </td>
                <td>{r.backtest?.label ?? '—'}</td>
                <td>{r.live?.label ?? '—'}</td>
                <td className="mvp-inv-tells">{r.note}</td>
                <td className="mvp-num">{r.issue ? `#${r.issue}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mvp-foot">
        Verified against the source by <code>validate-parity-register.cjs</code>, which runs in
        <code> prebuild</code>. A mechanism that leaves one side, or a register that goes stale, fails the
        build — so this table cannot quietly stop being true.
      </p>
    </>
  );
}
