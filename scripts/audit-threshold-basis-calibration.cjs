/**
 * audit-threshold-basis-calibration.cjs — is `EARN_ABLE_BAR` still doing the job it was measured for?
 *
 * ⚠️ WHY THIS EXISTS (#1131). `EARN_ABLE_BAR = { entry: 7.5, strong: 20 }` in
 * `nest/src/modules/scoring/signal-threshold-basis.ts` is a CONSTANT derived from a POPULATION. It was
 * swept so that "20% of earn-able capacity" produces the same number of STRONG labels as "13% of
 * configured capacity" does (measured 2026-10-21 on 6,493 ticks: 543 vs 541).
 *
 * Nothing holds that true. A protocol's earn-able share moves whenever its directive set changes or a
 * directive gains/loses the ability to emit a direction — and when a directive stops being neutral-only
 * (`gen-directive-capabilities --check` records the change), every earn-able percentage in that
 * protocol shifts. The bar stays put, the population does not, and the labels drift with **no error,
 * no warning, and a plausible number** — this repo's most expensive failure signature.
 *
 * ⚠️ WHAT IS CHECKED — THE PROPERTY, NOT THE NUMBER. Re-deriving the bar today will always differ
 * slightly from the day it was calibrated; that is not drift. The property is:
 *
 *     at 20% of earn-able, do we still label the same SHARE of readings STRONG as 13% of configured?
 *
 * If that share moves more than `TOLERANCE` relative to today's incumbent, the constant no longer
 * preserves frequency and needs re-sweeping. The bar itself is reported for information only.
 *
 * ⚠️⚠️ KNOWN LIMITATION OF THIS GUARD, measured on its first real reading (2026-10-21): the target is
 * itself a MOVING quantity. Because the population is a ROLLING window, the incumbent's label share
 * drifts with market regime, so a fixed bar cannot pin a fixed share across regimes. First run over a
 * 7,000-tick window: entry drift 3.2% (fine), strong drift 13.3% (over the ±10% band) — with the
 * extra ticks being one ordinary day, not a change to any directive.
 *
 * So a FAIL here means exactly "the declared bar no longer reproduces the incumbent's share on
 * TODAY'S window" — which is true, and is not by itself proof that the constant is stale. Before
 * re-sweeping, re-run on a NARROW window (`--days=1`) and on a wide one and see whether the drift is
 * regime or structure. Do NOT respond to a FAIL by widening `TOLERANCE` — that is relaxing a guard to
 * get green, which is the failure this repo names explicitly.
 *
 * ⚠️ A verifier that cannot read its input must ERROR, never pass — so an empty population, a missing
 * `earnableSignalMax`, or an unreadable constant exits non-zero with the reason.
 *
 *   node scripts/audit-threshold-basis-calibration.cjs              # live, against recorded ticks
 *   node scripts/audit-threshold-basis-calibration.cjs --self-test  # prove the verdict can go both ways
 *   node scripts/audit-threshold-basis-calibration.cjs --days 30    # narrow the population
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MYSQL = 'C:\\wamp64\\bin\\mysql\\mysql9.1.0\\bin\\mysql.exe';
const DB = 'mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs';
const BASIS_SRC = path.join(__dirname, '..', 'nest', 'src', 'modules', 'scoring', 'signal-threshold-basis.ts');
/** A protocol that returns a real payload; used only to read the declared constant back. */
const API = process.env.TCS_API || 'http://localhost:3201';
const SYMBOL_FOR_API = process.env.CALIBRATION_SYMBOL || 'XAUUSD';
const PROTOCOL_FOR_API = process.env.CALIBRATION_PROTOCOL || 'xau-speed-m15';

/** Relative tolerance on the labelled SHARE. 10% of a 541-tick target = ±54 ticks. */
const TOLERANCE = Number(process.env.CALIBRATION_TOLERANCE || 0.10);
/**
 * Below this many ticks a verdict is noise wearing a result's clothes — the same failure the A/B
 * verdict machine refuses to make. Exit **2** (cannot judge) is deliberately distinct from **1**
 * (drift detected), so a thin population is never mistaken for a calibration failure.
 */
const MIN_SAMPLES = Number(process.env.CALIBRATION_MIN_SAMPLES || 200);
const SAMPLE_STEP = 0.25;
const SAMPLE_MAX = 60;

/**
 * Recover the declared `EARN_ABLE_BAR` from source (independent cross-check).
 *
 * Regex on purpose: the constant is a literal in a `.ts` module and this script is plain CJS. If the
 * declaration shape changes the regex MUST fail loudly — a silent `undefined` would turn every check
 * below into a comparison against `NaN`, which compares false and reads exactly like a pass.
 */
function readDeclaredBar(src) {
  const m = /export const EARN_ABLE_BAR\s*=\s*\{\s*entry:\s*([\d.]+)\s*,\s*strong:\s*([\d.]+)\s*\}/.exec(src);
  if (!m) throw new Error('cannot read EARN_ABLE_BAR from signal-threshold-basis.ts — the declaration shape changed');
  const entry = Number(m[1]);
  const strong = Number(m[2]);
  if (!Number.isFinite(entry) || !Number.isFinite(strong) || entry <= 0 || strong <= 0) {
    throw new Error(`EARN_ABLE_BAR parsed as ${m[1]}/${m[2]} — refusing to audit a non-positive bar`);
  }
  return { entry, strong };
}

/**
 * Read the declared bar from the RUNNING API (`meta.thresholdBasis.earnableBar`).
 *
 * The API is authoritative — it reports the constant the classifier actually imported. The source
 * parse above is the independent check, so the two disagreeing is itself a finding (a stale `dist`,
 * or a constant edited without a rebuild). Reading ONLY source would be brittle; reading ONLY the API
 * would be self-referential.
 */
async function readDeclaredBarFromApi() {
  const url = `${API}/api/scoring/gated/${SYMBOL_FOR_API}?protocol=${PROTOCOL_FOR_API}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const body = await res.json();
  const bar = body?.meta?.thresholdBasis?.earnableBar;
  if (!bar || !(bar.entry > 0) || !(bar.strong > 0)) {
    throw new Error('API payload has no meta.thresholdBasis.earnableBar — the build predates it');
  }
  return { entry: Number(bar.entry), strong: Number(bar.strong) };
}

/**
 * Reconcile the two readings of the constant. Pure, so the self-test can drive every branch —
 * including the one that matters most: the two sources disagreeing, which means one of them is stale.
 */
function reconcileDeclaredBars(fromSource, fromApi) {
  if (fromSource && fromApi) {
    const agree = fromSource.entry === fromApi.entry && fromSource.strong === fromApi.strong;
    return {
      bar: agree ? fromSource : null,
      ok: agree,
      degraded: false,
      reason: agree
        ? 'source and the running API agree'
        : `source ${fromSource.entry}/${fromSource.strong} vs API ${fromApi.entry}/${fromApi.strong}`,
    };
  }
  if (fromApi) return { bar: fromApi, ok: true, degraded: true, reason: 'API only — unconfirmed by source' };
  if (fromSource) return { bar: fromSource, ok: true, degraded: true, reason: 'source only — unconfirmed by the API' };
  return { bar: null, ok: false, degraded: true, reason: 'neither source nor API is readable' };
}

async function resolveDeclaredBar() {
  let fromSource = null;
  let sourceError = null;
  try { fromSource = readDeclaredBar(fs.readFileSync(BASIS_SRC, 'utf8')); } catch (err) { sourceError = err.message; }

  let fromApi = null;
  let apiError = null;
  try { fromApi = await readDeclaredBarFromApi(); } catch (err) { apiError = err.message; }

  const verdict = reconcileDeclaredBars(fromSource, fromApi);
  if (!verdict.ok) {
    console.error('[calibration] ✖ ABORT: cannot trust EARN_ABLE_BAR —', verdict.reason);
    if (sourceError) console.error(`              source error: ${sourceError}`);
    if (apiError) console.error(`              api error   : ${apiError}`);
    console.error('              Usually a stale `dist` against newer source. Auditing against either');
    console.error('              would be auditing against an assumption — fix the build first.');
    process.exit(verdict.bar === null && !fromSource && !fromApi ? 2 : 1);
  }
  if (verdict.degraded) console.warn(`[calibration] ⚠ ${verdict.reason}`);
  else console.log(`[calibration] declared bar confirmed: ${verdict.reason}`);
  return verdict.bar;
}

/**
 * What bar (in earn-able terms) reproduces `target` labels on this population? Returns the closest
 * value on a fixed grid, plus how far the count it produces is from the target.
 */
function sweepToTarget(samples, target) {
  let best = null;
  for (let pct = SAMPLE_STEP; pct <= SAMPLE_MAX; pct += SAMPLE_STEP) {
    let count = 0;
    for (const s of samples) if (s.pctEarnable >= pct) count++;
    const err = Math.abs(count - target);
    if (!best || err < best.err) best = { bar: Number(pct.toFixed(2)), count, err };
  }
  return best;
}

/** The verdict for one label class. Pure, so the self-test can drive it both ways. */
function judge({ samples, targetCount, declaredBar, tolerance = TOLERANCE }) {
  if (!samples.length) return { ok: false, reason: 'no samples — nothing to judge' };
  if (!(targetCount >= 0)) return { ok: false, reason: 'target count is not a number' };
  if (!(declaredBar > 0)) return { ok: false, reason: 'declared bar is not positive' };
  const atDeclared = samples.filter((s) => s.pctEarnable >= declaredBar).length;
  const target = Math.max(1, targetCount);
  const relative = Math.abs(atDeclared - targetCount) / target;
  const repro = sweepToTarget(samples, targetCount);
  return {
    ok: relative <= tolerance,
    atDeclared,
    targetCount,
    relative,
    reproBar: repro.bar,
    reproCount: repro.count,
    reason: relative <= tolerance
      ? `at ${declaredBar}% earn-able: ${atDeclared} labels vs ${targetCount} incumbent (${(relative * 100).toFixed(1)}% drift)`
      : `at ${declaredBar}% earn-able: ${atDeclared} labels vs ${targetCount} incumbent (${(relative * 100).toFixed(1)}% drift > ${(tolerance * 100).toFixed(0)}%) — re-sweep to ~${repro.bar}%`,
  };
}

function selfTest() {
  const declared = readDeclaredBar(fs.readFileSync(BASIS_SRC, 'utf8'));
  let failures = 0;
  const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? '✔' : '✖'} ${label}`); };

  // A population built so that `declared` reproduces it exactly.
  const healthy = Array.from({ length: 1000 }, (_, i) => ({ pctEarnable: (i / 1000) * 60 }));
  const countAt = (arr, bar) => arr.filter((s) => s.pctEarnable >= bar).length;

  const good = judge({ samples: healthy, targetCount: countAt(healthy, declared.strong), declaredBar: declared.strong });
  check('passes when the declared bar reproduces the population', good.ok);

  // The same population judged with a bar that is far too low: it would label far more than the
  // incumbent, which is precisely the failure this guard exists to notice.
  const loose = judge({ samples: healthy, targetCount: countAt(healthy, declared.strong), declaredBar: declared.strong / 4 });
  check('fails when the declared bar labels far too many', !loose.ok);

  const tight = judge({ samples: healthy, targetCount: countAt(healthy, declared.strong), declaredBar: declared.strong * 3 });
  check('fails when the declared bar labels far too few', !tight.ok);

  // "Cannot judge" cases must ERROR, not pass.
  check('fails on an empty population', !judge({ samples: [], targetCount: 10, declaredBar: declared.strong }).ok);
  check('fails on a non-numeric target', !judge({ samples: healthy, targetCount: NaN, declaredBar: declared.strong }).ok);
  check('fails on a non-positive bar', !judge({ samples: healthy, targetCount: 10, declaredBar: 0 }).ok);

  // The regex must fail loudly on a changed declaration rather than yielding NaN.
  let regexFails = false;
  try { readDeclaredBar('export const EARN_ABLE_BAR = readFromConfig();'); } catch { regexFails = true; }
  check('readDeclaredBar() throws when the declaration shape changes', regexFails);

  // Reconciliation — the branch that matters: source and API disagreeing means one is STALE, and
  // auditing against either would be auditing against an assumption.
  const src = { entry: 7.5, strong: 20 };
  const agree = reconcileDeclaredBars(src, { entry: 7.5, strong: 20 });
  check('reconcile: agreeing sources produce a bar', agree.ok && agree.bar.strong === 20 && !agree.degraded);
  const conflict = reconcileDeclaredBars(src, { entry: 7.5, strong: 13 });
  check('reconcile: DISAGREEING sources refuse to produce a bar', !conflict.ok && conflict.bar === null);
  const apiOnly = reconcileDeclaredBars(null, src);
  check('reconcile: API-only is usable but marked degraded', apiOnly.ok && apiOnly.degraded);
  const neither = reconcileDeclaredBars(null, null);
  check('reconcile: neither available is a hard failure', !neither.ok && neither.bar === null);

  console.log(failures === 0
    ? `[calibration] ✅ self-test passed (11 checks) — declared bar ${declared.entry}/${declared.strong}`
    : `[calibration] ✖ self-test FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

function readTicks(days) {
  const sql = [
    'SELECT REPLACE(TO_BASE64(sc.breakdown), "\\n", "") FROM score sc',
    `WHERE sc.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${Number(days)} DAY)`,
    'ORDER BY sc.timestamp',
  ].join(' ');
  const out = execFileSync(MYSQL, [
    '--user=tradingcs', '--password=tradingcs_dev_2026', '--host=127.0.0.1',
    '--database=tradingcs', '--skip-column-names', '--raw', '--execute=' + sql,
  ], { maxBuffer: 512 * 1024 * 1024, encoding: 'latin1' });
  const ticks = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let b; try { b = JSON.parse(Buffer.from(line, 'base64').toString('utf8')); } catch { continue; }
    const raw = Number(b?.rawComposite);
    const configured = Number(b?.configuredSignalMax);
    const earnable = Number(b?.earnableSignalMax);
    if (!Number.isFinite(raw) || !(configured > 0)) continue;
    // Rows written before `earnableSignalMax` existed cannot be judged — counting them as 0 would
    // read as "everything is earn-able", which is the wrong answer rather than no answer.
    if (!Number.isFinite(earnable) || !(earnable > 0)) continue;
    ticks.push({
      raw, configured, earnable,
      pctConfigured: (raw / configured) * 100,
      pctEarnable: (raw / earnable) * 100,
      signal: String(b?.signal ?? ''),
    });
  }
  return ticks;
}

if (process.argv.includes('--self-test')) selfTest();

(async () => {
const days = Number((process.argv.find((a) => a.startsWith('--days=')) || '').split('=')[1] || 30);
console.log(`[calibration] reading ${days} day(s) of recorded ticks from ${DB.replace(/:[^:@]+@/, ':***@')}`);

const declared = await resolveDeclaredBar();
const ticks = readTicks(days);
console.log(`[calibration] declared EARN_ABLE_BAR = ${declared.entry}% entry / ${declared.strong}% strong`);
console.log(`[calibration] ticks with BOTH denominators recorded: ${ticks.length}`);

if (ticks.length === 0) {
  console.error('[calibration] ✖ ABORT: no ticks carry `earnableSignalMax`. Nothing is verified —');
  console.error('              this is not a pass. Run again once ticks with the field exist.');
  process.exit(1);
}

if (ticks.length < MIN_SAMPLES) {
  console.error(`[calibration] ⏸ CANNOT JUDGE: ${ticks.length} tick(s) carry both denominators, ` +
    `need ${MIN_SAMPLES}.`);
  console.error('              A verdict on a population this thin would be noise wearing a result\'s');
  console.error('              clothes. Exiting 2 (distinct from 1 = drift) rather than passing or failing.');
  process.exit(2);
}

// The incumbent's own counts on THIS population — the target the calibration must reproduce.
const incumbentStrong = ticks.filter((t) => t.signal.startsWith('STRONG_')).length;
const incumbentEntry = ticks.filter((t) => ['BUY', 'SELL', 'STRONG_BUY', 'STRONG_SELL'].includes(t.signal)).length;

const strong = judge({ samples: ticks, targetCount: incumbentStrong, declaredBar: declared.strong });
const entry = judge({ samples: ticks, targetCount: incumbentEntry, declaredBar: declared.entry });

console.log('');
console.log(`  STRONG  ${strong.ok ? '✅' : '✖'}  ${strong.reason}`);
console.log(`  entry   ${entry.ok ? '✅' : '✖'}  ${entry.reason}`);
console.log('');
console.log('  "labels" = recorded ticks at or above the bar. The bar is reported for information; the');
console.log('  verdict is on the SHARE, because preserving frequency is the job the constant was given.');
if (strong.reproBar !== declared.strong || entry.reproBar !== declared.entry) {
  console.log(`  re-sweep would give: entry ${entry.reproBar}% · strong ${strong.reproBar}%`);
}

const ok = strong.ok && entry.ok;
console.log(ok
  ? '\n[calibration] ✅ the calibrated bar still preserves the incumbent label frequency'
  : '\n[calibration] ✖ the population has moved — EARN_ABLE_BAR needs re-sweeping (see #1131)');
process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error(`[calibration] ✖ ABORT: ${err?.message ?? err}`);
  process.exit(2);
});
