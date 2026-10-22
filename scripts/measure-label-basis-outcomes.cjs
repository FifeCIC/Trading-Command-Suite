/**
 * measure-label-basis-outcomes.cjs — which label basis actually called direction better? (#1131)
 *
 * ⚠️ WHY THIS EXISTS. Flipping `THRESHOLD_BASIS` to 'earnable' was blocked because "the calibrated
 * label was never traded, so there is no outcome evidence". **That was wrong.** Both label sets can be
 * applied to the SAME historical ticks, and `marketbar` holds the forward prices to score them. So the
 * comparison does not need a live A/B to say anything at all — it needs a join.
 *
 * What it measures, per label set:
 *   • how many ticks carried a DIRECTIONAL call (BUY/SELL/STRONG_*),
 *   • how often that call matched the direction price actually moved,
 *   • the mean signed return of those calls.
 *
 * And then, crucially: **on the ticks where the two bases DISAGREE**, which one was right. That is the
 * only population where the choice matters — everywhere else the decision changes nothing.
 *
 * ⚠️ WHAT THIS IS NOT. It is a DIRECTION HIT RATE, not a P&L. No spread, no commission, no slippage,
 * no stop, no position sizing, no risk multiplier. A hit rate above 50% is not a profitable system and
 * must not be reported as one. It answers one narrow question: does the calibrated bar separate
 * direction better than the incumbent bar on the same readings?
 *
 * ⚠️ Earnable capacity is RECOMPUTED per tick from the tick's own `breakouts` (plus the generated
 * always-neutral set and the protocol's gate groups), because `earnableSignalMax` was only persisted
 * from 2026-10-21 19:47 onward. A recomputation is not a record — say so in any citation.
 *
 *   node scripts/measure-label-basis-outcomes.cjs [--horizons=1,4,24] [--self-test]
 *
 * ⚠️⚠️ AN AGGREGATE HIT RATE OVER THIS DATA IS MOSTLY ONE PROTOCOL. Measured 2026-10-22: of 121
 * directional calls, **99 came from `probe-1dir-v1`** — an isolated single-directive probe — and only
 * 22 from real protocols. The first run of this script reported "62.8% hit rate" as if it described
 * the engine; it described a probe. A per-protocol split is printed for exactly this reason and warns
 * when one protocol supplies more than half the calls. Do not quote the aggregate without it.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MYSQL = 'C:\\wamp64\\bin\\mysql\\mysql9.1.0\\bin\\mysql.exe';
const API = process.env.TCS_API || 'http://localhost:3201';
const DIR = path.join(__dirname, '..', 'nest', 'src', 'modules', 'directives', 'implementations');

/** The incumbent basis, as live: 6 / 13 of CONFIGURED capacity. */
const INCUMBENT = { entry: 6, strong: 13 };
/** The calibrated basis: 7.5 / 20 of EARN-ABLE capacity, converted onto the configured scale. */
const CALIBRATED = { entry: 7.5, strong: 20 };

const DIRECTIONAL = new Set(['BUY', 'STRONG_BUY', 'SELL', 'STRONG_SELL']);
const BULLISH = new Set(['BUY', 'STRONG_BUY']);

/** Pure: which label does this reading carry under a given basis? */
function classify(pctConfigured, share, bar) {
  const strong = bar.strong * share;
  const entry = bar.entry * share;
  if (pctConfigured >= strong) return 'STRONG';
  if (pctConfigured >= entry) return 'ENTRY';
  return 'NONE';
}

/** Pure: did a directional call match the realised sign? Returns 1 / 0, or null when not judgeable. */
function scoreCall(label, ret) {
  if (!DIRECTIONAL.has(label)) return null;
  if (!Number.isFinite(ret) || ret === 0) return null;
  const wantedUp = BULLISH.has(label);
  return (wantedUp ? ret > 0 : ret < 0) ? 1 : 0;
}

function summarise(calls) {
  const judged = calls.filter((c) => c.hit !== null);
  const hits = judged.reduce((a, c) => a + c.hit, 0);
  const meanRet = judged.length ? judged.reduce((a, c) => a + c.ret, 0) / judged.length : NaN;
  return { n: judged.length, hits, rate: judged.length ? hits / judged.length : NaN, meanRet };
}

function selfTest() {
  let failures = 0;
  const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? '✔' : '✖'} ${label}`); };

  // Classification boundaries, both bases.
  const share = 0.5; // a protocol 50% of whose capacity is earn-able
  check('incumbent: 13% of configured is STRONG', classify(13, 1, INCUMBENT) === 'STRONG');
  check('incumbent: 5.9% of configured is below entry', classify(5.9, 1, INCUMBENT) === 'NONE');
  check('calibrated converts the bar down by the share (20×0.5 = 10%)', classify(10, 0.5, CALIBRATED) === 'STRONG');
  check('calibrated: the same 10% is only ENTRY without the share', classify(10, 1, CALIBRATED) === 'ENTRY');

  // Call scoring.
  check('BUY with a rising price is a hit', scoreCall('BUY', 0.01) === 1);
  check('BUY with a falling price is a miss', scoreCall('BUY', -0.01) === 0);
  check('SELL with a falling price is a hit', scoreCall('SELL', -0.01) === 1);
  check('a non-directional label is not judgeable', scoreCall('HOLD', 0.01) === null);
  check('a flat price is not judgeable', scoreCall('BUY', 0) === null);

  // The summary must not count unjudgeable ticks in the denominator.
  const s = summarise([{ hit: 1, ret: 0.02 }, { hit: 0, ret: -0.01 }, { hit: null, ret: 0 }]);
  check('summarise ignores unjudgeable calls', s.n === 2 && s.hits === 1 && Math.abs(s.rate - 0.5) < 1e-9);

  console.log(failures === 0
    ? '[outcomes] ✅ self-test passed (10 checks)'
    : `[outcomes] ✖ self-test FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

function neutralDirectives() {
  const neutral = new Set();
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    for (const part of src.split(/(?=@Injectable\(\))/)) {
      const id = part.match(/readonly\s+id\s*=\s*['"]([a-z0-9-]+)['"]/)?.[1];
      if (!id) continue;
      if (!/['"](bullish|bearish)['"]/.test(part)) neutral.add(id);
    }
  }
  return neutral;
}

async function gateGroups() {
  const res = await (await fetch(`${API}/api/scoring/gated/protocols`)).json();
  const map = new Map();
  for (const p of res.protocols || []) {
    map.set(p.id, new Set((p.groups || []).filter((g) => g.isRiskGate === true).map((g) => g.id ?? g.groupId)));
  }
  return map;
}

function query(sql) {
  return execFileSync(MYSQL, [
    '--user=tradingcs', '--password=tradingcs_dev_2026', '--host=127.0.0.1',
    '--database=tradingcs', '--skip-column-names', '--raw', '--execute=' + sql,
  ], { maxBuffer: 1024 * 1024 * 1024, encoding: 'latin1' });
}

(async () => {
  const horizonArg = (process.argv.find((a) => a.startsWith('--horizons=')) || '').split('=')[1]
    || (process.argv.find((a) => a.startsWith('--horizon=')) || '').split('=')[1];
  const horizons = String(horizonArg || '1,4,24').split(',').map(Number).filter((h) => Number.isFinite(h) && h > 0);
  if (horizons.length === 0) { console.error('[outcomes] ✖ ABORT: no usable horizon'); process.exit(2); }
  const h0 = horizons[0];
  const neutral = neutralDirectives();
  const gates = await gateGroups();

  console.log(`[outcomes] horizons: ${horizons.join(', ')}h on 1h bars · always-neutral directives: ${neutral.size}`);

  const raw = query(
    "SELECT CONCAT_WS('\\t', s.ticker, DATE_FORMAT(sc.timestamp,'%Y-%m-%d %H:%i:%s'), " +
    "REPLACE(TO_BASE64(sc.breakdown),'\\n','')) FROM score sc JOIN symbol s ON s.id=sc.symbolId ORDER BY sc.timestamp",
  );
  const ticks = [];
  let skippedNoDirection = 0;
  for (const line of raw.split('\n')) {
    if (!line.includes('\t')) continue;
    const [ticker, ts, b64] = line.split('\t');
    let b; try { b = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); } catch { continue; }
    const configured = Number(b?.configuredSignalMax);
    const rawC = Number(b?.rawComposite);
    if (!(configured > 0) || !Number.isFinite(rawC)) continue;
    const gateIds = gates.get(b?.protocolId) ?? new Set(['risk']);
    let neutralCap = 0;
    for (const [groupId, list] of Object.entries(b.breakouts || {})) {
      if (gateIds.has(groupId)) continue;
      for (const d of list) if (neutral.has(d.directiveId)) neutralCap += d.maxScore || 0;
    }
    const earnable = configured - neutralCap;
    if (!(earnable > 0)) continue;
    // ⚠️ A direction RECORD is required. `directionalEvidence` was only persisted from 2026-10-19;
    // before that the field is null, and defaulting it to zero makes every historical directional
    // tick reconstruct as HOLD (measured: 2,395 persisted BUY rows came back HOLD). Those ticks are
    // not wrong — they are unjudgeable, and they are excluded rather than counted against either basis.
    if (!b?.directionalEvidence) { skippedNoDirection++; continue; }
    ticks.push({
      ticker, ts, configured, earnable,
      protocol: String(b?.protocolId ?? '?'),
      pctConfigured: (rawC / configured) * 100,
      share: earnable / configured,
      incumbentLabel: String(b?.signal ?? ''),
      // ⚠️ DIRECTION MUST BE RECOMPUTED, NOT TAKEN FROM `directionalEvidence.selected`. That field is
      // the PRE-FILTER split — a LONG_ONLY protocol reading bearish evidence has `selected: 'bearish'`
      // there while the classifier correctly reports HOLD, because `selectDirectionalEvidence()` is a
      // presence test on the MODE's own side. Using the stored value produced a 38.5% match against
      // the persisted label and aborted; the mode rule below is the classifier's rule.
      mode: String(b?.directionMode ?? ''),
      bullishMax: Number(b?.directionalEvidence?.bullishMax ?? 0),
      bearishMax: Number(b?.directionalEvidence?.bearishMax ?? 0),
      // ⚠️ `signal` is not decided by the threshold alone — a closed readiness gate downgrades it to
      // HOLD regardless of the percentage. Measured: without this filter the reconstruction matched
      // the persisted label on only 38.5% of ticks, which reads as "the formula is wrong" when it is
      // actually "a second gate decided this one". Neither basis can act through a closed gate, so
      // those ticks are excluded from BOTH the identity check and the comparison.
      ready: b?.readinessGate?.ready !== false,
    });
  }
  console.log(`[outcomes] ticks with a usable denominator: ${ticks.length} `
    + `(excluded ${skippedNoDirection} with no direction record — written before 2026-10-19)`);
  if (ticks.length === 0) {
    console.error('[outcomes] ✖ ABORT: no ticks — nothing is measured.');
    process.exit(1);
  }

  // 1h bars, indexed per symbol in time order. Only the window the ticks span is needed.
  const firstTs = ticks[0].ts;
  const barRaw = query(
    `SELECT CONCAT_WS('\\t', s.ticker, DATE_FORMAT(b.timestamp,'%Y-%m-%d %H:%i:%s'), b.close) ` +
    `FROM marketbar b JOIN symbol s ON s.id=b.symbolId WHERE b.timeframe='1h' AND b.timestamp >= '${firstTs}' ORDER BY s.ticker, b.timestamp`,
  );
  const bars = new Map();
  for (const line of barRaw.split('\n')) {
    if (!line.includes('\t')) continue;
    const [ticker, ts, close] = line.split('\t');
    if (!bars.has(ticker)) bars.set(ticker, []);
    bars.get(ticker).push({ ts, close: Number(close) });
  }
  console.log(`[outcomes] 1h bars loaded: ${[...bars.values()].reduce((a, v) => a + v.length, 0)} across ${bars.size} symbols`);

  const calls = [];   // one per tick that had a price window
  let noPrice = 0;
  let reconMatch = 0;
  let reconChecked = 0;
  for (const t of ticks) {
    const series = bars.get(t.ticker);
    if (!series || series.length === 0) { noPrice++; continue; }
    if (!t.ready) { noPrice++; continue; }   // a closed gate decided this tick, not the threshold
    const entryIdx = series.findIndex((b) => b.ts > t.ts);
    if (entryIdx < 0) { noPrice++; continue; }
    const entry = series[entryIdx].close;
    if (!(entry > 0)) { noPrice++; continue; }
    // ONE pass, every horizon. A single-horizon run cannot tell "the edge is missing" from "the edge
    // is at a different holding time", and those need different fixes.
    const rets = {};
    for (const h of horizons) {
      if (entryIdx + h >= series.length) { rets[h] = NaN; continue; }
      rets[h] = (series[entryIdx + h].close - entry) / entry;
    }
    if (horizons.every((h) => !Number.isFinite(rets[h]))) { noPrice++; continue; }

    const incumbentLabel = t.incumbentLabel;
    const calClass = classify(t.pctConfigured, t.share, CALIBRATED);
    // The classifier's own direction rule: a presence test on the MODE's side, never a magnitude
    // comparison. Mirrors `selectDirectionalEvidence()` in score-units.ts.
    const direction = t.mode === 'LONG_ONLY' ? (t.bullishMax > 0 ? 'bullish' : 'none')
      : t.mode === 'SHORT_ONLY' ? (t.bearishMax > 0 ? 'bearish' : 'none')
      : (t.bullishMax > 0 ? 'bullish' : t.bearishMax > 0 ? 'bearish' : 'none');
    const labelFor = (cls) => {
      if (cls === 'NONE' || direction === 'none') return 'HOLD';
      const up = direction === 'bullish';
      if (cls === 'STRONG') return up ? 'STRONG_BUY' : 'STRONG_SELL';
      return up ? 'BUY' : 'SELL';
    };
    const incClass = classify(t.pctConfigured, 1, INCUMBENT);
    const calLabel = labelFor(calClass);
    const incLabelFromClass = labelFor(incClass);
    // Reconstructing the incumbent must reproduce the PERSISTED label, or my formula is not the
    // classifier's formula and every comparison below is measuring the wrong thing.
    if (['BUY', 'SELL', 'STRONG_BUY', 'STRONG_SELL', 'HOLD'].includes(incumbentLabel)) {
      reconChecked++;
      if (incLabelFromClass === incumbentLabel) reconMatch++;
    }
    calls.push({
      ticker: t.ticker, ts: t.ts, rets,
      protocol: t.protocol,
      pct: t.pctConfigured,
      // The incumbent label is RECONSTRUCTED from the same formula the classifier uses (6/13 of
      // configured) rather than read from the row, so both sides are computed identically and the
      // only input that differs is the basis. `incLabelFromClass` should equal the persisted
      // `signal` on every tick — that identity is asserted below.
      incLabel: incLabelFromClass,
      calLabel,
      persisted: DIRECTIONAL.has(incumbentLabel) ? incumbentLabel : 'HOLD',
      incClass,
      calClass,
    });
  }

  console.log(`[outcomes] ticks with a full price window: ${calls.length} (skipped ${noPrice})`);
  const reconRate = reconChecked ? reconMatch / reconChecked : 0;
  console.log(`[outcomes] reconstruction check — 6/13 of configured reproduces the persisted label on `
    + `${reconMatch}/${reconChecked} ticks (${(reconRate * 100).toFixed(1)}%)`);
  if (reconRate < 0.99) {
    console.error('[outcomes] ✖ ABORT: the reconstructed incumbent label does not match the persisted one.');
    console.error('              That means this script\'s formula is not the classifier\'s formula, so a');
    console.error('              comparison built on it would be measuring the wrong thing. Not proceeding.');
    const pairs = new Map();
    for (const c of calls) {
      if (c.persisted === 'HOLD' && c.incLabel === 'HOLD') continue;
      if (c.persisted === c.incLabel) continue;
      const k = `persisted ${c.persisted} -> reconstructed ${c.incLabel}`;
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
    console.error('\n              mismatch pairs (top 8):');
    for (const [k, v] of [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.error(`                ${String(v).padStart(5)}  ${k}`);
    }
    process.exit(1);
  }
  if (calls.length === 0) {
    console.error('[outcomes] ✖ ABORT: no tick could be joined to a forward price — nothing is measured.');
    process.exit(1);
  }

  const inc = summarise(calls.map((c) => ({ hit: scoreCall(c.incLabel, c.rets[h0]), ret: c.rets[h0] })));
  const cal = summarise(calls.map((c) => ({ hit: scoreCall(c.calLabel, c.rets[h0]), ret: c.rets[h0] })));
  const shares = ticks.map((t) => t.share).sort((a, b) => a - b);
  const med = shares.length ? shares[Math.floor(shares.length / 2)] : NaN;
  console.log(`\n[outcomes] earn-able share across the population: min ${(shares[0] ?? NaN).toFixed(3)} · `
    + `median ${med.toFixed(3)} · max ${(shares[shares.length - 1] ?? NaN).toFixed(3)}`);
  const classDiff = calls.filter((c) => c.incClass !== c.calClass).length;
  console.log(`[outcomes] ticks where the two BARS disagree (before any price join): ${classDiff}`);
  // ⚠️ WHY THE BANDS CAN BE EMPTY. Scores are DISCRETE (integer directive points over a fixed
  // denominator), so `pct` can only take a sparse set of values. A threshold band a fraction of a
  // point wide may contain no achievable value at all — which makes a threshold change a STEP, not a
  // smooth percentage shift. Printing only the OCCUPIED bins, because a dense grid of mostly-empty
  // bins hides the gap that is the actual finding.
  const hist = new Map();
  for (const c of calls) {
    const bin = (Math.round(c.pct * 2) / 2).toFixed(1);
    hist.set(bin, (hist.get(bin) ?? 0) + 1);
  }
  const occupied = [...hist].sort((a, b) => Number(a[0]) - Number(b[0]));
  console.log(`[outcomes] occupied pct bins (${occupied.length} distinct values across ${calls.length} ticks):`);
  console.log('  ' + occupied.slice(0, 30).map(([b, n]) => `${b}%:${n}`).join('  '));
  if (occupied.length > 30) console.log(`  … and ${occupied.length - 30} more`);
  const maxObserved = Math.max(...calls.map((c) => c.pct));
  const betweenEntryStrong = calls.filter((c) => c.pct >= 6 && c.pct < 13).length;
  console.log(`  max pct observed ${maxObserved.toFixed(1)}% · ticks between entry(6%) and strong(13%): ${betweenEntryStrong}`);
  const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
  const bp = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : '—');

  console.log('\n── BOTH BASES ON THE SAME TICKS ──');
  console.log(`  horizon ${h0}h`);
  console.log('  basis            directional calls   hits   hit rate   mean signed return');
  console.log(`  incumbent 6/13   ${String(inc.n).padStart(17)}   ${String(inc.hits).padStart(4)}   ${pct(inc.rate).padStart(8)}   ${bp(inc.meanRet).padStart(8)}`);
  console.log(`  calibrated 7.5/20${String(cal.n).padStart(17)}   ${String(cal.hits).padStart(4)}   ${pct(cal.rate).padStart(8)}   ${bp(cal.meanRet).padStart(8)}`);

  // ── Horizon sweep — "no edge" and "edge at a different holding time" need different fixes ──
  console.log('\n── HORIZON SWEEP (incumbent calls, same label set, different exit time) ──');
  console.log('  horizon   calls   hits   hit rate   mean signed return   hits>50% but mean<0?');
  for (const h of horizons) {
    const row = calls
      .map((c) => ({ hit: scoreCall(c.incLabel, c.rets[h]), ret: c.rets[h] }))
      .filter((c) => c.hit !== null);
    const s = summarise(row);
    const inverted = Number.isFinite(s.rate) && s.rate > 0.5 && s.meanRet < 0;
    console.log(`  ${String(h).padStart(6)}h   ${String(s.n).padStart(5)}   ${String(s.hits).padStart(4)}   `
      + `${pct(s.rate).padStart(8)}   ${bp(s.meanRet).padStart(19)}   ${inverted ? 'YES' : ''}`);
  }
  console.log('  "hits>50% but mean<0" means the calls are right more often than wrong yet still lose —');
  console.log('  the losses are LARGER than the wins. That is an exit/asymmetry problem, not an entry one.');

  // ── The population that actually matters: where the two bases disagree ──
  const disagree = calls.filter((c) => (DIRECTIONAL.has(c.incLabel) ? 'D' : 'N') !== (DIRECTIONAL.has(c.calLabel) ? 'D' : 'N'));
  console.log(`\n── TICKS WHERE THE BASES DISAGREE (one calls, the other does not): ${disagree.length} ──`);
  if (disagree.length === 0) {
    console.log('  none in this window — the choice changes nothing on the observed population');
  } else {
    const incCalls = disagree.map((c) => scoreCall(c.incLabel, c.rets[h0])).filter((x) => x !== null);
    const calCalls = disagree.map((c) => scoreCall(c.calLabel, c.rets[h0])).filter((x) => x !== null);
    const incWins = incCalls.filter((x) => x === 1).length;
    const calWins = calCalls.filter((x) => x === 1).length;
    console.log(`  incumbent called ${incCalls.length}, right ${incWins}`);
    console.log(`  calibrated called ${calCalls.length}, right ${calWins}`);
    const incRate = incCalls.length ? incWins / incCalls.length : NaN;
    const calRate = calCalls.length ? calWins / calCalls.length : NaN;
    console.log(`  hit rate on the disputed ticks : incumbent ${pct(incRate)} · calibrated ${pct(calRate)}`);
    if (!Number.isFinite(incRate) || !Number.isFinite(calRate) || (incCalls.length + calCalls.length) < 30) {
      console.log('  ⚠️ too few disputed ticks to prefer either basis — this is not a verdict');
    }
  }

  // ── Per-protocol split — an aggregate hit rate can be one instrument's behaviour wearing a
  // system's clothes. Any conclusion about "the engine" has to survive being broken apart.
  console.log('\n── PER-PROTOCOL (incumbent calls, ' + h0 + 'h) ──');
  const byProto = new Map();
  for (const c of calls) {
    const k = c.protocol;
    if (!byProto.has(k)) byProto.set(k, []);
    byProto.get(k).push({ hit: scoreCall(c.incLabel, c.rets[h0]), ret: c.rets[h0] });
  }
  const protoRows = [...byProto].map(([k, v]) => ({ k, ...summarise(v) }))
    .filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  console.log('  protocol'.padEnd(24), 'calls'.padStart(6), 'hits'.padStart(6), 'hit rate'.padStart(10), 'mean'.padStart(9));
  for (const r of protoRows) {
    console.log(`  ${r.k.padEnd(24)} ${String(r.n).padStart(6)} ${String(r.hits).padStart(6)} `
      + `${pct(r.rate).padStart(10)} ${bp(r.meanRet).padStart(9)}`);
  }
  const dominant = protoRows[0];
  if (dominant && protoRows.length > 1 && dominant.n / Math.max(1, protoRows.reduce((a, r) => a + r.n, 0)) > 0.5) {
    console.log(`  ⚠️ ${dominant.k} supplies ${dominant.n} of ${protoRows.reduce((a, r) => a + r.n, 0)} calls —`);
    console.log('     the aggregate above is mostly ONE protocol, not a property of the engine.');
  }

  console.log('\n⚠️ Direction hit rate only. No spread, commission, slippage, stop or sizing is modelled,');
  console.log('   so this is NOT a P&L. Earnable capacity is RECOMPUTED from each tick\'s breakouts, not');
  console.log('   read from a record — `earnableSignalMax` only exists in rows from 2026-10-21 19:47 onward.');
})().catch((err) => {
  console.error(`[outcomes] ✖ ABORT: ${err?.message ?? err}`);
  process.exit(2);
});
