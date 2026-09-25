/**
 * ScoringThresholds — the gated-threshold readings, in two presentations.
 * =====================================================================
 * ⚠️ WHY THIS EXISTS (2026-09-16, §617)
 * -------------------------------------
 * The threshold data used to live as one inline section on the General settings page. The
 * settings rework puts the CLASSIFICATION scale on Scoring and the PER-BOT readings on
 * Trading — two pages, two audiences, one dataset.
 *
 * The cheap version of that would be two components each calling
 * `/api/scoring/gated/thresholds` and each deciding for itself what "CANNOT FIRE" means.
 * That is precisely the shape this repo has been bitten by: two implementations that drift
 * apart, with only one of them getting the next fix. So the query, the `clears → verdict`
 * mapping and the "no data" distinction are defined ONCE, here, and both pages render them.
 *
 * ⚠️ Why the numbers matter (the incident this section was built for)
 * ------------------------------------------------------------------
 * The app stopped trading completely on 2026-09-10 and nobody could see why. ADR-011 changed
 * the percentage DENOMINATOR from the observed directional sum (~130) to the configured
 * capacity (~725-815) — about 6.3x larger — so every percentage divided by that factor.
 * Every threshold stayed on the old scale, `ENTRY_THRESHOLD = 40` classified every tick as
 * HOLD, and no trade executed for five days.
 *
 * The diagnosis had been written in code comments **three separate times**. Nobody could SEE
 * the numbers. These components are the fix for that, not for the numbers themselves: an
 * invisible threshold is one that cannot be questioned.
 *
 * ⚠️ `no-data` is deliberately distinct from `cannot-fire`. The first means unmeasured, the
 * second means structurally blocked. Conflating them would make a merely-unmeasured bot look
 * broken — and a broken bot look merely unmeasured.
 *
 * ⚠️ All values are READ-ONLY. They are derived from the scoring classification config, not
 * stored as a user preference, so an editable field would write nowhere. The job here is
 * visibility.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { SettingRow } from './SettingsControls';

/**
 * The single query both presentations share.
 *
 * ⚠️ One `queryKey` on purpose: React Query then serves both pages from one cached read, so
 * the number on Scoring and the number on Trading are literally the same value rather than
 * two fetches that happened to agree.
 */
export function useGatedThresholds() {
  return useQuery({
    queryKey: ['scoring-thresholds'],
    queryFn: () => apiGet('/api/scoring/gated/thresholds'),
    staleTime: 60_000,
    retry: 1,
  });
}

/** `clears` → presentation. Defined once so both tables cannot disagree. */
export function thresholdVerdict(clears) {
  if (clears === 'yes') return { text: 'clears', cls: 'threshold-ok' };
  if (clears === 'no') return { text: 'CANNOT FIRE', cls: 'threshold-bad' };
  return { text: 'no data', cls: 'threshold-unknown' };
}

/**
 * One loading/error vocabulary for both presentations.
 *
 * Returns `{ data, node }` where a non-null `node` is the thing to render instead of the
 * table. Deliberately NOT a "render nothing while loading" pattern: a blank gap is
 * indistinguishable from an empty dataset, and the whole point of this section is that
 * "cannot judge" must not look like "fine" (silent-empty anti-pattern).
 */
function useThresholdState() {
  const { data, isLoading, isError } = useGatedThresholds();

  if (isLoading) {
    return { data: null, node: <p className="settings-section-desc">Loading thresholds…</p> };
  }
  if (isError || !data) {
    return {
      data: null,
      node: (
        <p className="settings-section-desc">
          Could not load thresholds from the API. They are reported by
          <code> GET /api/scoring/gated/thresholds</code>.
        </p>
      ),
    };
  }
  return { data, node: null };
}

/**
 * ThresholdClassification — the SCALE and the bars, without the per-bot table.
 * Rendered on Scoring, where the question is "what counts as a signal?".
 */
export function ThresholdClassification() {
  const { data, node } = useThresholdState();
  if (node) return node;

  const { classification, preTradeGate, summary, windowDays } = data;

  return (
    <>
      <SettingRow
        label="Entry threshold"
        hint="A reading is BUY/SELL at or above this, HOLD below it. Was 40 before the 2026-09-15 rescale — at which point nothing could ever clear it, so no signal was ever queued."
      >
        <code>{classification.entry}%</code>
      </SettingRow>
      <SettingRow
        label="Strong threshold"
        hint="A reading is STRONG_BUY / STRONG_SELL at or above this.">
        <code>{classification.strong}%</code>
      </SettingRow>
      <SettingRow
        label="What the percentages are measured against"
        hint="This is the scale that matters. When the denominator changed, every threshold below silently became unreachable.">
        <code>{classification.scale}</code>
      </SettingRow>
      <SettingRow
        label="Pre-trade gate"
        hint={`Blocks a signal whose strength is below this. Resolved as: per-protocol override → trading style → default (${preTradeGate.default}).`}>
        <code>{Object.entries(preTradeGate.byStyle).map(([k, v]) => `${k} ${v}`).join(' · ')}</code>
      </SettingRow>
      <SettingRow
        label="Bot bars"
        hint={`Each bot has its own bar (minComposite). ${summary.activeClearing} of ${summary.active} active bots have cleared theirs in the last ${windowDays} days.`}>
        <span className={summary.activeCannotFire > 0 ? 'threshold-bad' : 'threshold-ok'}>
          {summary.activeCannotFire > 0
            ? `${summary.activeCannotFire} active bot(s) CANNOT FIRE`
            : 'No active bot is structurally blocked'}
          {summary.activeNoData > 0 && ` · ${summary.activeNoData} unmeasured`}
        </span>
      </SettingRow>

      {/*
        ⚠️ Sits directly under the two ceiling readings above, because it answers the other half
        of the same question: those say what a protocol HAS reached, this says how much of the
        scale it is being measured against could ever be earned. Reading one without the other is
        how a low percentage gets mistaken for a broken protocol.
      */}
      <ReachableCapacity />
    </>
  );
}

/**
 * BotBarsTable — the same reading, per bot.
 * Rendered on Trading, where the question is "can each of my bots actually fire?".
 *
 * ⚠️ The closing warning is not decoration. A bar that clears looks like a green light, and
 * it is not: it admits a trade so the trade can be MEASURED. Directional accuracy has been
 * at or below chance, so a cleared bar is permission to gather evidence, never evidence of
 * edge.
 */
export function BotBarsTable() {
  const { data, node } = useThresholdState();
  if (node) return node;

  const { bots, windowDays } = data;
  const active = bots.filter((b) => b.active);

  if (active.length === 0) {
    // ⚠️ An empty list is information; it must not render as a blank gap that reads like a
    // failed request. "No active bots" is a real, actionable state.
    return <p className="settings-section-desc">No active bots are configured.</p>;
  }

  return (
    <>
      <div className="setting-row">
        <div className="setting-info" style={{ maxWidth: '100%', width: '100%' }}>
          <strong>Bot bar vs achieved ceiling</strong>
          <p>
            <code>achieved</code> is the highest composite the bot&apos;s protocol has actually
            produced in {windowDays} days. <strong>A bar above its achieved value can never
            fire.</strong>
          </p>
          <div className="threshold-table-wrap">
            <table className="threshold-table">
              <thead>
                <tr>
                  <th scope="col">Bot</th>
                  <th scope="col">Symbol</th>
                  <th scope="col">Bar</th>
                  <th scope="col">Achieved</th>
                  <th scope="col">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {active.map((b) => {
                  const v = thresholdVerdict(b.clears);
                  return (
                    <tr key={`${b.name}-${b.symbol}`} className={v.cls}>
                      <td>{b.name}</td>
                      <td>{b.symbol}</td>
                      <td>{b.barPct}%</td>
                      <td>{b.achievedPct == null ? '—' : `${b.achievedPct}%`}</td>
                      <td className={v.cls}>{v.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '0.5rem' }}>
            ⚠️ <strong>A bot clearing its bar is not evidence of profit.</strong> These bars
            admit trades so they can be <em>measured</em>. Directional accuracy has been
            at or below chance — see the edge report before drawing conclusions.
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * ReachableCapacity — how much of each protocol's denominator has NEVER been earned
 * directionally, and what its ceiling becomes on a scale that excludes that capacity.
 *
 * ⚠️ WHY THIS EXISTS (#761 point 3)
 * ---------------------------------
 * `ThresholdClassification` above reports the measured ceiling as a percentage of the FULL
 * configured denominator. #761 established those percentages are honest but that the BANDS
 * were calibrated on the old inflated scale — and asks the follow-up directly: *"configured
 * capacity includes directives that are structurally unlikely to fire together, so the
 * practical ceiling is well below the configured max. Worth measuring the realistic
 * maximum."* `peakReach%` is that measurement.
 *
 * ⚠️ ON DEMAND, NOT ON PAGE LOAD — and that is deliberate.
 * `GET /api/scoring/gated/reachable-capacity` costs ~500 ms because it walks every recorded
 * breakdown. The `thresholds` endpoint above already measured 4793 ms against a 5000 ms
 * budget, so bolting this on would have broken that budget; and fetching it eagerly on the
 * Scoring page would make every visit pay 500 ms for a number most visits do not read.
 * So the query is `enabled: false` until the reader asks for it.
 *
 * ⚠️ THIS ASSERTS NO VERDICT. It is the one place in this file that does not print a
 * CANNOT FIRE badge, and that is on purpose. A high `never%` is largely a STRUCTURAL
 * property of the stable-denominator design — direction eligibility comes from config, not
 * from the tick (SETTLED-DECISIONS rows 2 and 3) — NOT a per-protocol fault. This repo
 * already retired a warning of exactly this shape (#906, ADR-011): it derived capacity from
 * declared `directionBias`, fired for 14 of 17 protocols on one structural cause, and
 * carried no information. Reproducing that framing here would repeat it. The numbers are
 * raw and the explanation travels with them.
 *
 * ⚠️ `—` IS NOT `0`. `peakReach%` is null when nothing was ever directional: nothing was
 * reachable, so there is no ratio, rather than a ratio of zero. Same distinction the rest of
 * this file makes between "no data" and "cannot fire".
 */
export function ReachableCapacity() {
  const [open, setOpen] = useState(false);
  const { data, isFetching, isError } = useQuery({
    queryKey: ['scoring-reachable-capacity'],
    queryFn: () => apiGet('/api/scoring/gated/reachable-capacity?days=7'),
    enabled: open,
    staleTime: 300_000,
    retry: 1,
  });

  return (
    <div className="setting-row">
      <div className="setting-info" style={{ maxWidth: '100%', width: '100%' }}>
        <strong>Reachable capacity</strong>
        <p>
          How much of each protocol&apos;s configured capacity has <em>never</em> been earned
          directionally, and what its best reading becomes on a scale excluding it.{' '}
          <strong>A high figure is mostly structural, not a fault</strong> — see the note
          below before reading it as one.
        </p>
        {!open && (
          <button type="button" className="cta" onClick={() => setOpen(true)}>
            Measure reachable capacity (~0.5s)
          </button>
        )}
        {open && isFetching && (
          <p className="settings-section-desc">Measuring… this walks every recorded breakdown.</p>
        )}
        {open && isError && (
          <p className="settings-section-desc">
            Could not measure reachable capacity. Reported by
            <code> GET /api/scoring/gated/reachable-capacity</code>.
          </p>
        )}
        {open && data && (
          <>
            <p className="settings-section-desc">
              {data.baseline.protocols} protocols · median{' '}
              <strong>{data.summary.medianNeverPct}%</strong> of configured capacity never earned
              directionally · worst <code>{data.summary.worst.slug}</code> at{' '}
              {data.summary.worst.neverPct}% · best <code>{data.summary.best.slug}</code> at{' '}
              {data.summary.best.neverPct}%
            </p>
            <div className="threshold-table-wrap">
              <table className="threshold-table">
                <thead>
                  <tr>
                    <th scope="col">Protocol</th>
                    <th scope="col">Configured</th>
                    <th scope="col">Reachable</th>
                    <th scope="col">Never %</th>
                    <th scope="col">Peak % now</th>
                    <th scope="col">Peak % of reachable</th>
                  </tr>
                </thead>
                <tbody>
                  {data.protocols.map((p) => (
                    <tr key={p.slug}>
                      <td>{p.slug}</td>
                      <td>{p.configuredCapacity}</td>
                      <td>{p.reachableCapacity}</td>
                      <td>{p.neverPct}%</td>
                      <td>{p.peakPctOfConfigured}%</td>
                      <td>{p.peakPctOfReachable == null ? '—' : `${p.peakPctOfReachable}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: '0.5rem' }}>
              ⚠️ <strong>This is not a warning list.</strong> A directive that has never been
              directional in this window is indistinguishable from one that was simply never
              exercised, and a large share is expected from the stable-denominator design — the
              denominator counts every non-gate directive, while only directional ones can earn.{' '}
              <strong>Treat a high figure as &ldquo;investigate&rdquo;, not as proof.</strong>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
