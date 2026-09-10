/**
 * Is the score denominator counting capacity the numerator can never reach?
 *
 * WHY THIS EXISTS (#761)
 * ---------------------
 * The percentage shown for a protocol is `signalRaw / configuredSignalMax`.
 * `signalRaw` can ONLY contain directives that returned `signalClass` bullish or
 * bearish. `configuredSignalMax` (`capacityMaxTotal`, protocol-gating.service.ts
 * ~L725) counts EVERY non-gate directive:
 *
 *     if (!isGateGroup) { capacityMax += maxScore; }
 *
 * If a directive never returns a directional class, its maxScore is denominator
 * that can never be earned. This script measures how much of each active
 * protocol's denominator is in that category.
 *
 * ⚠️ MEASURE OUTCOMES, NOT DECLARATIONS.
 * An earlier version of this script read `directionBias` from /api/directives and
 * concluded 95% of capacity was unreachable. That was WRONG: the API's populated
 * field is `bias`, not `directionBias`, so nearly every directive read as
 * `neutral`. Declarations also lag implementations — `macd-crossover`,
 * `gold-macro-correlation` and `analyst-adjustments` declare `neutral` yet emit
 * directional classes in practice.
 *
 * So this version asks the recorded scores instead: over N days, did this
 * directive in this protocol EVER emit bullish/bearish? That cannot be fooled by
 * a missing or stale declaration.
 *
 * Read-only. From nest/:
 *   node scripts/analyse-unreachable-capacity.cjs            # 7 days
 *   node scripts/analyse-unreachable-capacity.cjs --days 30
 *   node scripts/analyse-unreachable-capacity.cjs --json
 *
 * ⚠️ A directive that has genuinely never been exercised (new, or gated by
 * missing data) looks identical to one that is structurally incapable. Treat a
 * high `never` figure as "investigate", not as "proof".
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const daysIdx = argv.indexOf('--days');
const DAYS = daysIdx >= 0 && argv[daysIdx + 1] ? Number(argv[daysIdx + 1]) : 7;

/** Live API base. Overridable so the script can point at another instance. */
const API = process.env.TCS_API ?? 'http://localhost:3201';

async function main() {
  const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);

  // 1. Configured capacity per protocol, one row per (protocol, directive).
  //    MAX(maxScore) mirrors the scorer's de-duplication: a directive listed in
  //    several groups is scored once, so only one copy of its capacity is real.
  const protocols = await prisma.protocol.findMany({
    where: { active: true },
    include: { directiveGroups: { include: { directives: { where: { active: true } } } } },
  });

  // 1b. Direction-mode exclusions — CRITICAL for this measurement.
  //
  // ⚠️ The scorer already drops capacity the protocol's `directionMode` forbids, via
  // `classifyDirectiveInclusion` at protocol-gating.service.ts L539, BEFORE accumulating.
  // Verified: `gold-macro-v1` is LONG_ONLY, non-gate capacity 935, live
  // `configuredSignalMax` 795 = 935 - 140 (`rsi-overbought`). A denominator that ignores
  // direction mode over-counts by exactly that and makes the problem look worse than it is.
  //
  // The polarity MUST come from `directionBias` on the implementation class — NOT the DB
  // `directive.nature` column, which reads `predictive` for the RSI pair and so excludes
  // nothing. That mismatch is the drift `protocol-health.service.ts` warns about.
  //
  // Read from the live API, which is also how the running app resolves it. If the API is
  // down, exclusions are reported as unknown rather than silently assumed absent.
  let biasCache = null;
  try {
    const res = await fetch(`${API}/api/directives`);
    if (res.ok) {
      const body = await res.json();
      const list = Array.isArray(body) ? body : body.directives ?? [];
      biasCache = new Map();
      for (const d of list) {
        // ⚠️ Prefer `directionBias` but fall back to `bias`. The live API populates
        // `directionBias` and leaves `bias` null; reading only one of them silently
        // yields an all-null map, which is how an earlier version of this analysis
        // reported a nonsense 95%-unreachable figure.
        const bias = d.directionBias || d.bias || null;
        if (bias) biasCache.set(d.id, bias);
      }
      if (biasCache.size === 0) biasCache = null;
    }
  } catch (err) {
    // ⚠️ RECORD the failure. An earlier version swallowed it with a bare `catch {}`,
    // which turned a ReferenceError (an undefined `API` constant) into an innocent
    // "API is down" message — the silent-empty anti-pattern.
    console.warn(`[warn] /api/directives request failed: ${err?.message ?? err}`);
  }

  const exclusionUnknown = biasCache === null;
  if (exclusionUnknown) {
    console.warn('[warn] could not read /api/directives — direction-mode exclusions are NOT');
    console.warn('       applied, so the denominator below is larger than the scorer\'s and');
    console.warn('       every `never%` figure is an OVER-estimate. Start the API and re-run.');
  }

  // 2. Did each (protocol, directive) ever return a directional class?
  //    Read from the persisted breakdown, which is the only record of what the
  //    directive actually returned.
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT s.strategyId AS slug,
           JSON_UNQUOTE(JSON_EXTRACT(g.val, '$.directiveId')) AS directiveId,
           SUM(JSON_UNQUOTE(JSON_EXTRACT(g.val, '$.signalClass')) IN ('bullish','bearish')) AS directionalHits,
           COUNT(*) AS observations
      FROM score s,
           JSON_TABLE(s.breakdown, '$.breakouts.*[*]' COLUMNS (val JSON PATH '$')) g
     WHERE s.timestamp > ?
     GROUP BY s.strategyId, directiveId
    `,
    since,
  );

  const directional = new Set();
  const observed = new Set();
  for (const r of rows) {
    if (!r.slug || !r.directiveId) continue;
    observed.add(`${r.slug}::${r.directiveId}`);
    if (Number(r.directionalHits) > 0) directional.add(`${r.slug}::${r.directiveId}`);
  }

  // 3. Group the capacity.
  const out = [];
  for (const p of protocols) {
    const seen = new Set();
    const dirMode = p.directionMode ?? 'LONG_ONLY';
    let denom = 0;        // what the SCORER counts (direction-mode exclusions applied)
    let everDir = 0;
    let neverDir = 0;
    let unobserved = 0;
    let excludedByMode = 0;

    for (const g of p.directiveGroups) {
      if (g.isRiskGate === true) continue; // gate capacity is excluded by the scorer
      for (const e of g.directives) {
        if (seen.has(e.directiveId)) continue;
        seen.add(e.directiveId);
        const max = Number(e.maxScore || 0);

        // Apply the SAME rule classifyDirectiveInclusion applies, so `denom` is the
        // scorer's denominator rather than an over-count.
        const bias = biasCache?.get(e.directiveId) ?? null;
        const forbidden =
          (dirMode === 'LONG_ONLY' && bias === 'bearish') ||
          (dirMode === 'SHORT_ONLY' && bias === 'bullish');
        if (forbidden) { excludedByMode += max; continue; }

        denom += max;
        const key = `${p.slug}::${e.directiveId}`;
        if (!observed.has(key)) unobserved += max;
        else if (directional.has(key)) everDir += max;
        else neverDir += max;
      }
    }

    // Highest composite recorded for this protocol in the window — the numerator
    // side, so the effect of the denominator can be seen directly.
    const peak = await prisma.score.aggregate({
      where: { strategyId: p.slug, timestamp: { gt: since } },
      _max: { value: true },
    });
    const peakVal = peak._max.value == null ? null : Number(peak._max.value);
    const pctNow = peakVal != null && denom > 0 ? (100 * peakVal) / denom : null;
    const pctReachable = peakVal != null && everDir > 0 ? (100 * peakVal) / everDir : null;

    out.push({
      slug: p.slug,
      directionMode: dirMode,
      denominator: denom,
      excludedByDirectionMode: excludedByMode,
      everDirectional: everDir,
      neverDirectional: neverDir,
      unobserved,
      neverPct: denom > 0 ? (100 * neverDir) / denom : 0,
      unobservedPct: denom > 0 ? (100 * unobserved) / denom : 0,
      peakPctNow: pctNow,
      peakPctReachable: pctReachable,
    });
  }

  out.sort((a, b) => b.neverPct - a.neverPct);

  if (asJson) {
    console.log(JSON.stringify({ days: DAYS, generatedAt: new Date().toISOString(), protocols: out }, null, 2));
    return;
  }

  console.log(`\nDenominator analysis — last ${DAYS} days of recorded scores\n`);
  const h = (s, w) => String(s).padStart(w);
  console.log(
    'protocol'.padEnd(20) + h('denom', 8) + h('exclMode', 9) + h('everDir', 9) +
    h('never', 8) + h('never%', 8) + h('unobs%', 8) + h('peakNow%', 10) + h('peakReach%', 12),
  );
  console.log('-'.repeat(92));
  for (const r of out) {
    console.log(
      r.slug.padEnd(20) +
      h(r.denominator, 8) + h(r.excludedByDirectionMode, 9) + h(r.everDirectional, 9) +
      h(r.neverDirectional, 8) + h(r.neverPct.toFixed(1), 8) + h(r.unobservedPct.toFixed(1), 8) +
      h(r.peakPctNow == null ? '-' : r.peakPctNow.toFixed(1), 10) +
      h(r.peakPctReachable == null ? '-' : r.peakPctReachable.toFixed(1), 12),
    );
  }

  const sorted = [...out].sort((a, b) => a.neverPct - b.neverPct);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)].neverPct : 0;
  const worst = out[0];
  console.log('\nsummary');
  console.log(`  protocols                     : ${out.length}`);
  console.log(`  median never-directional share: ${median.toFixed(1)}%`);
  if (worst) console.log(`  worst                         : ${worst.slug} @ ${worst.neverPct.toFixed(1)}%`);
  console.log(
    `  peak reading, now vs reachable: ` +
    out.filter((r) => r.peakPctNow != null).map((r) => `${r.slug} ${r.peakPctNow.toFixed(0)}%->${r.peakPctReachable == null ? '-' : r.peakPctReachable.toFixed(0) + '%'}`).slice(0, 4).join(', '),
  );
  console.log('\nA high `never` share means the denominator counts capacity the numerator cannot reach.');
  console.log('`unobs%` > 0 means those directives were not exercised in the window — investigate, do not conclude.');
  console.log('`exclMode` is capacity the scorer ALREADY excludes by direction mode, and is not a defect.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('FAILED:', e.message);
    await prisma.$disconnect();
    process.exit(1);
  });
