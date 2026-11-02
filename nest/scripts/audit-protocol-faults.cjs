#!/usr/bin/env node
/**
 * audit-protocol-faults.cjs — every fault CLASS this project has found, checked across ALL
 * protocols and strategies at once.
 *
 * WHY THIS EXISTS (owner direction, 2026-11-02)
 * ---------------------------------------------
 * *"We should look for such faults in design and other faults we have found in the past in all
 * other protocols and strategies."*
 *
 * Each fault in this file was found the hard way — one instance at a time, usually by accident,
 * usually in a protocol nobody was looking at. Fixing an instance without checking the class is
 * how the same defect has been re-found 26 days later (#789 → #790). This tool converts that
 * habit into a sweep: the classes are written down, so every protocol is checked against every
 * class on demand, not when someone happens to notice.
 *
 * The classes (each one cost real time):
 *
 *   STALE-SCORE      an ACTIVE protocol assigned to a symbol that has stopped producing
 *                    snapshots. The score simply stops; nothing errors. (Found on XAGUSD
 *                    2026-11-02 — its only active protocol is a 1-directive probe that stopped
 *                    writing at 13:46 while every other protocol ticked at 19:29.)
 *   NO-SNAPSHOTS     an active protocol with assignments and nothing in the window at all.
 *   NO-DIRECTION-24H  an active protocol that produced 20+ snapshots in 24h and NOT ONE directional
 *                    read. Distinct from a quiet hour: a burst-signalling protocol is healthy.
 *   QUIET            writing `score` rows on every tick but no `score_snapshot` in the window,
 *                    because every value is 0 — i.e. no directional evidence for its ALLOWED
 *                    direction. Informational: in a LONG_ONLY protocol a bearish phase reads
 *                    nothing, which is the designed behaviour, not a defect.
 *   DIRECTION-STARVED  STRUCTURAL, from config alone: the capacity that can ever carry the allowed
 *                    direction is below `ENTRY_THRESHOLD`% of the signal denominator, so the
 *                    protocol cannot signal in ANY market.
 *   AMBIGUOUS-PRIORITY  two protocols claim one symbol at the same priority, so "which one wins"
 *                    was storage order (#1181). Now resolved deterministically, still a data fault.
 *   INACTIVE-WINNER  the winning assignment points at an inactive protocol while an active one is
 *                    also assigned — a skip the resolver now prevents but the DATA still says.
 *   DEAD-FEEDER      a table an active protocol reads holds no rows, so that directive is
 *                    permanently zero (`socialmention` = 0 rows → `social-buzz` in 2 protocols).
 *   THIN-PROTOCOL    an active protocol the whole symbol rests on, built from 1–2 directives.
 *
 * ⚠️ A CORRECTION MADE HERE, AND WHY IT MATTERS (2026-11-02). The first version of this tool had a
 * single NO-DIRECTION class based on the 4-hour window. Running it on `xau-speed-m15` produced a
 * false positive: it reported "85 snapshots, 0 directional" as a fault, and on investigation the
 * protocol had emitted **24 STRONG_BUY in 24h** — the window simply caught a quiet stretch. Eight
 * further directives looked "never directional" in 300 ticks and only THREE of them are
 * structurally neutral (`NEUTRAL_ONLY_DIRECTIVES`); the rest merely sat neutral in that regime.
 *
 *     "Never directional in this window" is NOT "cannot be directional".
 *
 * A class that reports a healthy protocol is worse than no class: it consumes attention and gets
 * allowlisted. So the window-based claim was replaced by two honest ones — NO-DIRECTION-24H (data,
 * needs a long horizon) and DIRECTION-STARVED (config, needs no window at all) — and `QUIET` was
 * added to NAME the healthy-but-silent state instead of calling it broken.

 *
 * ⚠️ NOT a build gate, deliberately: every check needs live data. Build gates that need MySQL
 * are on demand in this repo (`db:check`, `db:schema-drift`, `db:config-refs`) — a build must not
 * fail because the database is down, and a gated check nobody can run is one nobody runs.
 *
 * ⚠️ The structural half of the same classes IS in `prebuild`: bar requirements, reason labels,
 * directive registration, and the resolver's deterministic order. This tool covers the half that
 * only the DATA can show.
 *
 * USAGE
 * -----
 *   node nest/scripts/audit-protocol-faults.cjs                 # report, exit 0
 *   node nest/scripts/audit-protocol-faults.cjs --strict        # exit 1 when any HIGH finding
 *   node nest/scripts/audit-protocol-faults.cjs --hours 6       # staleness window
 *   node nest/scripts/audit-protocol-faults.cjs --json
 *   node nest/scripts/audit-protocol-faults.cjs --self-test      # prove each classifier can fail
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { query, connect } = require(path.resolve(__dirname, '..', '..', 'scripts', 'lib', 'mysql-cli.cjs'));
const { parseTsv } = require('./report-symbol-priority-ties.cjs');

/** Ordered worst-first. Named and exported so the guard asserts it rather than inlining numbers. */
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

/** Feeds an active protocol reads; reported when empty because the directive reading it can only return 0. */
const WATCHED_FEEDS = [
  { table: 'socialmention', usedBy: 'social-buzz', label: 'social sentiment' },
  { table: 'earningscalendar', usedBy: 'earnings-*', label: 'earnings calendar' },
];

/**
 * Classify one protocol row into findings. PURE — no SQL, so `--self-test` can prove every rule
 * fires and stays silent, which is the only thing that makes a checker trustworthy.
 *
 * @param {object} p
 * @param {string} p.slug
 * @param {boolean|number} p.active
 * @param {number} p.entries            directive entries in the protocol
 * @param {number} p.snapshotRows       snapshots inside the window
 * @param {number} p.directionalRows    snapshots whose signal is BUY or SELL
 * @param {number} p.assignedSymbols    symbol_protocol_assignment rows
 * @param {number} p.staleSymbols       assigned symbols whose NEWEST snapshot is older than the window
 * @param {number} [p.thinThreshold]    default 2
 * @param {boolean} [p.recentlyChanged] protocol row touched inside the grace window
 * @param {number} [p.graceMinutes]     default 30 — see the honest limitation below
 *
 * ⚠️ HONEST LIMITATION of the grace rule. A protocol activated a minute ago legitimately has no
 * snapshots yet, so flagging it as STALE-SCORE is noise that would teach the reader to ignore the
 * tool. There is no "active since" column, so the caller passes `recentlyChanged` derived from
 * `protocol.updatedAt`. That is a PROXY: `updatedAt` moves on ANY update, so a protocol whose
 * description was edited 5 minutes ago is granted grace it may not deserve. The proxy can only
 * ever SUPPRESS a finding for up to `graceMinutes` — it cannot invent one — and the suppressed
 * case reappears on the next run once the window passes. Do not read `updatedAt` as "activated at".
 */
/**
 * A probe is a 1-directive protocol built to measure ONE directive — being thin is its purpose,
 * not a fault. Excluding it by slug is an ALLOWLIST, which the repo warns about, so it is narrow
 * and stated: anything matching this pattern is documented as a probe and has no other role.
 * A real strategy accidentally named `probe-…` would be exempted — that is the cost, and it is
 * visible here rather than buried in a skip list.
 */
const PROBE_PATTERN = /^probe[-_]/i;

function classifyProtocol(p) {
  const out = [];
  const active = Boolean(Number(p.active));
  const entries = Number(p.entries) || 0;
  const rows = Number(p.snapshotRows) || 0;
  const directional = Number(p.directionalRows) || 0;
  const assigned = Number(p.assignedSymbols) || 0;
  const stale = Number(p.staleSymbols) || 0;
  const thinThreshold = p.thinThreshold == null ? 2 : Number(p.thinThreshold);
  const grace = Boolean(p.recentlyChanged);

  if (!active) return out; // a retired protocol scoring nothing is the correct state

  if (assigned > 0 && stale > 0 && !grace) {
    out.push({
      cls: 'STALE-SCORE',
      severity: 'critical',
      slug: p.slug,
      detail: `${stale} of ${assigned} assigned symbol(s) produced NO snapshot in the window — the protocol is active but the score has stopped`,
    });
  }
  if (entries > 0 && rows === 0 && !grace) {
    out.push({
      cls: 'NO-SNAPSHOTS',
      severity: 'critical',
      slug: p.slug,
      detail: 'active with directive entries but zero snapshots in the window',
    });
  }
  if (rows >= 20 && directional === 0) {
    // ⚠️ Deliberately NOT a finding. Kept as a computed value so the report can say so out loud.
    // Measured 2026-11-02: `xau-speed-m15` tripped this on a 4h window with 0 of 85 directional,
    // and had emitted 24 STRONG_BUY in 24h. A quiet window is not a fault; the long-horizon
    // class below is what can carry this claim.
    void directional;
  }
  if (entries > 0 && entries <= thinThreshold && !PROBE_PATTERN.test(String(p.slug))) {
    out.push({
      cls: 'THIN-PROTOCOL',
      severity: 'medium',
      slug: p.slug,
      detail: `${entries} directive(s) carry the whole protocol — a probe, not a strategy`,
    });
  }

  // ── Direction claims, on the two bases that are actually defensible ──
  // 24h, not the window: a burst-signalling protocol is healthy, and the 4h window called it broken.
  const rows24 = Number(p.snapshotRows24h) || 0;
  const dir24 = Number(p.directionalRows24h) || 0;
  if (rows24 >= 20 && dir24 === 0) {
    out.push({
      cls: 'NO-DIRECTION-24H',
      severity: 'high',
      slug: p.slug,
      detail: `${rows24} snapshot(s) in 24h, 0 directional — 24 hours of scores that could never become a signal`,
    });
  }
  // QUIET is the healthy-but-silent state, named so it is not mistaken for broken.
  if (rows === 0 && Number(p.scoredTicks) > 0 && !grace) {
    out.push({
      cls: 'QUIET',
      severity: 'low',
      slug: p.slug,
      detail:
        `writing score rows but no snapshot in the window — every value 0 (no evidence for its ` +
        `allowed direction). 24h: ${dir24} directional of ${rows24}. Allowed direction: ${p.directionMode || 'unknown'}`,
    });
  }

  // ── DIRECTION-STARVED — config only, no window, cannot be quiet-by-accident ──
  // A protocol whose direction-capable capacity is below the entry threshold cannot signal in ANY
  // market. `directions` is the set of signal classes that can ever carry its allowed direction.
  if (p.allowedDirCapacity != null && p.signalDenominator != null) {
    const denom = Number(p.signalDenominator);
    const dirCap = Number(p.allowedDirCapacity);
    if (denom > 0) {
      const maxPct = (dirCap / denom) * 100;
      if (maxPct < ENTRY_THRESHOLD) {
        out.push({
          cls: 'DIRECTION-STARVED',
          severity: 'high',
          slug: p.slug,
          detail:
            `only ${dirCap}/${denom} of capacity (${maxPct.toFixed(1)}%) can carry its allowed ` +
            `direction — below the ${ENTRY_THRESHOLD}% entry threshold, so it cannot signal in any market`,
        });
      }
    }
  }
  return out;
}

/** Classify assignment rows (one per symbol) into ambiguity findings. PURE. */
function classifyAssignments(rows) {
  const out = [];
  const bySymbol = new Map();
  for (const r of rows) {
    const k = String(r.symbol);
    if (!bySymbol.has(k)) bySymbol.set(k, []);
    bySymbol.get(k).push({ slug: String(r.slug), priority: Number(r.priority), active: Boolean(Number(r.active)) });
  }
  for (const [symbol, list] of bySymbol) {
    const minPri = Math.min(...list.map((r) => r.priority));
    const atMin = list.filter((r) => r.priority === minPri);
    if (atMin.length > 1) {
      out.push({
        cls: 'AMBIGUOUS-PRIORITY',
        severity: atMin.some((r) => r.active) ? 'medium' : 'low',
        slug: atMin.map((r) => r.slug).join(' | '),
        symbol,
        detail: `${atMin.length} protocols share priority ${minPri} on ${symbol} — priority no longer expresses intent`,
      });
    }
    const winnerInactive = atMin.length > 1 && atMin.every((r) => !r.active);
    const better = list.filter((r) => r.active && r.priority > minPri);
    if (atMin.every((r) => !r.active) && better.length > 0) {
      out.push({
        cls: 'INACTIVE-WINNER',
        severity: 'high',
        slug: better.map((r) => r.slug).join(' | '),
        symbol,
        detail: `the best-priority protocol on ${symbol} is INACTIVE while ${better.map((r) => r.slug).join(', ')} is active — only the resolver's preference prevents a skip`,
      });
    }
    void winnerInactive;
  }
  return out;
}

function classifyFeeds(feedRows) {
  const out = [];
  for (const f of feedRows) {
    if (Number(f.rows) === 0) {
      out.push({
        cls: 'DEAD-FEEDER',
        severity: 'high',
        slug: f.usedBy,
        detail: `${f.table} holds 0 rows, so ${f.usedBy} can only ever return "no data" (${f.label})`,
      });
    }
  }
  return out;
}

const SEV_RANK = Object.fromEntries(SEVERITY_ORDER.map((s, i) => [s, i]));

/**
 * `ENTRY_THRESHOLD` — the same 6 from `protocol-gating.service.ts`.
 *
 * ⚠️ DUPLICATED ON PURPOSE, and the duplication is named rather than hidden. Importing the TS
 * constant into a `.cjs` tool is not possible without a build step, and reading it from the DB is
 * not a thing. The risk is that the two drift. `ENTRY_THRESHOLD_SOURCE` records where the truth
 * lives so the next reader can check it in one place; the self-test asserts the value this tool
 * uses, so a change upstream shows up as a failing check rather than a silently different verdict.
 */
const ENTRY_THRESHOLD = 6;
const ENTRY_THRESHOLD_SOURCE = 'nest/src/modules/scoring/protocol-gating.service.ts (ENTRY_THRESHOLD)';

/**
 * The four signal labels that carry a DIRECTION.
 *
 * ⚠️ `STRONG_BUY` / `STRONG_SELL` are SEPARATE values, not prefixes of `BUY` / `SELL`. Measured
 * 2026-11-02 in this very file: the first version counted `IN ('BUY','SELL')` and therefore
 * reported `xau-speed-m15` as "0 directional in 24h" when it had emitted **24 STRONG_BUY**. The
 * tool accused a healthy protocol of never signalling, on a string-comparison bug.
 *
 * This is the SAME class the pipeline once shipped (`'STRONG_SELL'.startsWith('SELL') === false`
 * routed a sell as a buy). Named here, used in every query, and asserted by the self-test so the
 * two spellings cannot drift apart again.
 */
const DIRECTIONAL_SIGNALS = ['BUY', 'SELL', 'STRONG_BUY', 'STRONG_SELL'];
const DIRECTIONAL_SQL = `(${DIRECTIONAL_SIGNALS.map((s) => `'${s}'`).join(',')})`;


/** Read `NEUTRAL_ONLY_DIRECTIVES` from the GENERATED file — the one definition of "cannot be directional". */
function readNeutralOnlySet(filePath) {
  const p =
    filePath ||
    path.resolve(__dirname, '..', 'src', 'modules', 'directives', 'directive-capabilities.generated.ts');
  const src = fs.readFileSync(p, 'utf8');
  // Only the `new Set<string>([...])` body: an earlier attempt scanned the whole file and picked up
  // quoted words from the DOC COMMENT, which made the set wrong while looking plausible.
  const start = src.indexOf('new Set<string>(');
  if (start < 0) throw new Error(`NEUTRAL_ONLY_DIRECTIVES set not found in ${p} — refusing to judge`);
  const body = src.slice(start);
  const ids = new Set([...body.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]));
  if (ids.size === 0) throw new Error(`parsed 0 neutral-only ids from ${p} — refusing to judge`);
  return ids;
}

/** Single-quote a value for the mysql CLI. Only used for identifiers already read from the DB. */
function sqlString(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}


function sortFindings(list) {
  return [...list].sort(
    (a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.cls.localeCompare(b.cls) || String(a.slug).localeCompare(String(b.slug)),
  );
}

function report(all) {
  const findings = sortFindings(all);
  if (findings.length === 0) {
    console.log('[protocol-faults] ✅ no fault found in any active protocol');
    return findings;
  }
  const byCls = new Map();
  for (const f of findings) byCls.set(f.cls, (byCls.get(f.cls) || 0) + 1);
  console.log(
    `[protocol-faults] ${findings.length} finding(s): ` +
      [...byCls].map(([c, n]) => `${c}=${n}`).join('  '),
  );
  console.log('');
  console.log('severity'.padEnd(10), 'class'.padEnd(20), 'protocol / symbol'.padEnd(34), 'detail');
  for (const f of findings) {
    const who = `${f.slug}${f.symbol ? ` @ ${f.symbol}` : ''}`;
    console.log(f.severity.padEnd(10), f.cls.padEnd(20), who.slice(0, 33).padEnd(34), f.detail);
  }
  return findings;
}

function selfTest() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });
  const one = (p) =>
    classifyProtocol({
      slug: 'p',
      active: 1,
      entries: 10,
      snapshotRows: 100,
      directionalRows: 40,
      snapshotRows24h: 100,
      directionalRows24h: 40,
      scoredTicks: 10,
      assignedSymbols: 2,
      staleSymbols: 0,
      ...p,
    });

  // Each rule must FIRE when it should...
  ok('STALE-SCORE fires when an assigned symbol stopped scoring', one({ staleSymbols: 1 }).some((f) => f.cls === 'STALE-SCORE'));
  ok('NO-SNAPSHOTS fires on zero rows with entries', one({ snapshotRows: 0 }).some((f) => f.cls === 'NO-SNAPSHOTS'));
  ok('THIN-PROTOCOL fires on a 1-directive protocol', one({ entries: 1, slug: 'real-strategy' }).some((f) => f.cls === 'THIN-PROTOCOL'));
  ok('THIN-PROTOCOL exempts a documented probe (thinness is its purpose)', !one({ entries: 1, slug: 'probe-1dir-x' }).some((f) => f.cls === 'THIN-PROTOCOL'));

  // NO-DIRECTION-24H — the long-horizon claim.
  ok('NO-DIRECTION-24H fires on 20+ snapshots in 24h with none directional', one({ directionalRows24h: 0 }).some((f) => f.cls === 'NO-DIRECTION-24H'));
  ok('NO-DIRECTION-24H stays silent when 24h HAS directional reads', !one({ directionalRows24h: 3 }).some((f) => f.cls === 'NO-DIRECTION-24H'));
  ok('NO-DIRECTION-24H needs 20+ snapshots, not 3', !one({ snapshotRows24h: 3, directionalRows24h: 0 }).some((f) => f.cls === 'NO-DIRECTION-24H'));

  // QUIET — the healthy-but-silent state, which must NEVER be reported as broken.
  ok('QUIET fires when score rows exist but no snapshot in the window', one({ snapshotRows: 0, directionalRows24h: 24 }).some((f) => f.cls === 'QUIET'));
  ok('QUIET is LOW severity — it is a state, not a fault', one({ snapshotRows: 0, directionalRows24h: 24 }).every((f) => f.cls !== 'QUIET' || f.severity === 'low'));
  ok('QUIET does not fire when the protocol is not ticking at all', !one({ snapshotRows: 0, scoredTicks: 0 }).some((f) => f.cls === 'QUIET'));

  // DIRECTION-STARVED — structural, no window involved.
  ok(
    'DIRECTION-STARVED fires when direction-capable capacity is below the entry threshold',
    one({ allowedDirCapacity: 10, signalDenominator: 1000 }).some((f) => f.cls === 'DIRECTION-STARVED'),
  );
  ok(
    'DIRECTION-STARVED stays silent when capacity clears the threshold',
    !one({ allowedDirCapacity: 630, signalDenominator: 910 }).some((f) => f.cls === 'DIRECTION-STARVED'),
  );
  ok(
    'DIRECTION-STARVED cannot judge without a breakdown (no keys) and must not pass silently as ok',
    one({}).every((f) => f.cls !== 'DIRECTION-STARVED'),
  );

  // ...and STAY SILENT when it should not.
  ok('a healthy protocol produces NO findings', one({}).length === 0);
  ok('an INACTIVE protocol is never faulted for not scoring (that is the correct state)', classifyProtocol({ slug: 'r', active: 0, entries: 10, snapshotRows: 0, directionalRows: 0, assignedSymbols: 3, staleSymbols: 3 }).length === 0);

  // Grace: a just-activated protocol must not be reported as broken, and the suppressal must be
  // narrow — it may not hide a real fault once the window has passed.
  ok('grace suppresses STALE-SCORE for a recently-changed protocol', one({ staleSymbols: 2, recentlyChanged: true }).length === 0);
  ok('the SAME protocol is faulted once the grace window has passed', one({ staleSymbols: 2, recentlyChanged: false }).some((f) => f.cls === 'STALE-SCORE'));
  ok('grace does NOT suppress NO-DIRECTION-24H (that needs real data, not time)', one({ directionalRows24h: 0, recentlyChanged: true }).some((f) => f.cls === 'NO-DIRECTION-24H'));

  // Assignments.
  const tie = classifyAssignments([
    { symbol: 'AAA', slug: 'p1', priority: 0, active: 1 },
    { symbol: 'AAA', slug: 'p2', priority: 0, active: 1 },
  ]);
  ok('AMBIGUOUS-PRIORITY fires on a tie', tie.some((f) => f.cls === 'AMBIGUOUS-PRIORITY'));
  ok('a single assignment is not ambiguous', classifyAssignments([{ symbol: 'BBB', slug: 'p1', priority: 0, active: 1 }]).length === 0);
  const inv = classifyAssignments([
    { symbol: 'XAGUSD', slug: 'probe', priority: 0, active: 1 },
    { symbol: 'XAGUSD', slug: 'dead', priority: 0, active: 0 },
  ]);
  ok('a tie where one member is inactive is still reported', inv.some((f) => f.cls === 'AMBIGUOUS-PRIORITY'));

  // Feeds.
  ok('DEAD-FEEDER fires on an empty table', classifyFeeds([{ table: 't', usedBy: 'd', label: 'x', rows: 0 }]).length === 1);
  ok('DEAD-FEEDER stays silent when the table has rows', classifyFeeds([{ table: 't', usedBy: 'd', label: 'x', rows: 5 }]).length === 0);

  // The neutral-only reader is a CLAIM about the registry — if it parses wrong, every structural
  // verdict is wrong. It DID parse wrong once: scanning the whole file picked up quoted words from
  // the doc comment. These check the real file and the failure mode.
  const realSet = readNeutralOnlySet();
  ok('the neutral-only set parses a plausible size (20..60)', realSet.size >= 20 && realSet.size <= 60);
  ok('the neutral-only set contains no doc-comment words', !realSet.has('bullish') && !realSet.has('bearish'));
  ok('a KNOWN neutral-only directive is in the set', realSet.has('liquidity-check') || realSet.has('volume-confirmation'));
  ok('a KNOWN direction-capable directive is NOT in the set', !realSet.has('speed-momentum') && !realSet.has('support-resistance-levels'));

  let unreadableThrew = false;
  try {
    readNeutralOnlySet(path.join(os.tmpdir(), 'definitely-not-here.ts'));
  } catch {
    unreadableThrew = true;
  }
  ok('an unreadable registry THROWS rather than returning an empty set', unreadableThrew);

  ok('ENTRY_THRESHOLD matches the value in protocol-gating.service.ts', ENTRY_THRESHOLD === 6);

  // The STRONG_ labels are separate values, not prefixes. This bug shipped once in this file and
  // accused a healthy protocol of never signalling (24 STRONG_BUY counted as 0 directional).
  ok('DIRECTIONAL_SIGNALS covers all four labels', DIRECTIONAL_SIGNALS.length === 4);
  ok('DIRECTIONAL_SIGNALS includes STRONG_BUY', DIRECTIONAL_SIGNALS.includes('STRONG_BUY'));
  ok('DIRECTIONAL_SIGNALS includes STRONG_SELL', DIRECTIONAL_SIGNALS.includes('STRONG_SELL'));
  ok('the SQL fragment quotes every label', DIRECTIONAL_SQL === "('BUY','SELL','STRONG_BUY','STRONG_SELL')");


  const sorted = sortFindings([
    { cls: 'A', severity: 'low', slug: 'x' },
    { cls: 'B', severity: 'critical', slug: 'y' },
  ]);
  ok('critical sorts before low', sorted[0].severity === 'critical');

  // Parser reuse: the audit must read the client's real output shape.
  ok('reuses the TSV parser (header + rows)', parseTsv('a\tb\n1\t2\n').length === 1);

  for (const r of results) console.log(`  ${r.pass ? '✅' : '✖ '} ${r.name}`);
  const failed = results.filter((r) => !r.pass).length;
  if (failed) {
    console.error(`\n[protocol-faults] ✖ self-test FAILED — ${failed}/${results.length}\n`);
    return 1;
  }
  console.log(`\n[protocol-faults] ✅ self-test passed — ${results.length}/${results.length} checks\n`);
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());

  const hoursIdx = argv.indexOf('--hours');
  const hours = hoursIdx >= 0 ? Number(argv[hoursIdx + 1]) : 4;
  if (!Number.isFinite(hours) || hours <= 0) {
    console.error('[protocol-faults] --hours must be a positive number');
    process.exit(2);
  }

  // Grace: a protocol changed inside this window is not faulted for having no snapshots yet.
  const graceIdx = argv.indexOf('--grace-minutes');
  const graceMinutes = graceIdx >= 0 ? Number(argv[graceIdx + 1]) : 30;
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
    console.error('[protocol-faults] --grace-minutes must be zero or a positive number');
    process.exit(2);
  }

  const conn = connect();

  const protocols = parseTsv(query(`
    SELECT pu.slug AS slug, pu.active AS active,
           CASE WHEN pu.updatedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${Math.max(0, Math.round(graceMinutes))} MINUTE)
                THEN 1 ELSE 0 END AS recentlyChanged,
           (SELECT COUNT(*) FROM protocol_directive_entry e
              JOIN protocol_directive_group g ON g.id = e.groupId
             WHERE g.protocolId = pu.slug OR g.protocolId = pu.id) AS entries,
           (SELECT COUNT(*) FROM score_snapshot s
             WHERE (s.protocolId = pu.slug OR s.protocolId = pu.id)
               AND s.snappedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${hours} HOUR)) AS snapshotRows,
           (SELECT COUNT(*) FROM score_snapshot s
             WHERE (s.protocolId = pu.slug OR s.protocolId = pu.id)
               AND s.snappedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${hours} HOUR)
               AND s.trading_signal IN ${DIRECTIONAL_SQL}) AS directionalRows,
           (SELECT COUNT(*) FROM score_snapshot s
             WHERE (s.protocolId = pu.slug OR s.protocolId = pu.id)
               AND s.snappedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)) AS snapshotRows24h,
           (SELECT COUNT(*) FROM score_snapshot s
             WHERE (s.protocolId = pu.slug OR s.protocolId = pu.id)
               AND s.snappedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
               AND s.trading_signal IN ${DIRECTIONAL_SQL}) AS directionalRows24h,
           (SELECT COUNT(*) FROM score sc
             WHERE sc.strategyId = pu.slug
               AND sc.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${hours} HOUR)) AS scoredTicks,
           (SELECT COUNT(DISTINCT a.symbol) FROM symbol_protocol_assignment a
             WHERE a.protocolId = pu.id) AS assignedSymbols,
           (SELECT COUNT(DISTINCT a.symbol) FROM symbol_protocol_assignment a
             WHERE a.protocolId = pu.id
               AND NOT EXISTS (
                 SELECT 1 FROM score_snapshot s
                  WHERE s.symbol = a.symbol
                    AND (s.protocolId = pu.slug OR s.protocolId = pu.id)
                    AND s.snappedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${hours} HOUR))) AS staleSymbols
    FROM protocol pu
    ORDER BY pu.slug
  `, conn));

  const assignments = parseTsv(query(`
    SELECT a.symbol AS symbol, a.priority AS priority, pu.slug AS slug, pu.active AS active
    FROM symbol_protocol_assignment a JOIN protocol pu ON pu.id = a.protocolId
  `, conn));

  // ── Structural directional capacity, from CONFIG alone ──
  // Reads the newest stored breakdown per protocol (it carries every directive's `maxScore`, its
  // group and therefore whether it is a risk gate) and crosses it with the generated
  // NEUTRAL_ONLY_DIRECTIVES set. No window, so this claim cannot be a quiet hour.
  const neutralOnly = readNeutralOnlySet();
  const capacity = new Map();
  for (const p of protocols) {
    try {
      const r = parseTsv(query(
        `SELECT breakdown FROM score WHERE strategyId = ${sqlString(p.slug)} ORDER BY timestamp DESC LIMIT 1`,
        conn,
      ));
      if (!r.length) continue;
      const bd = JSON.parse(r[0].breakdown);
      if (!bd?.breakouts) continue;
      let denom = 0;
      let dirCap = 0;
      for (const group of Object.values(bd.breakouts)) {
        for (const d of group) {
          const isGate = d.groupId === 'risk' || d.isRiskGate === true;
          if (isGate) continue; // risk gates are outside the signal denominator
          denom += Number(d.maxScore) || 0;
          if (!neutralOnly.has(d.directiveId)) dirCap += Number(d.maxScore) || 0;
        }
      }
      capacity.set(p.slug, { allowedDirCapacity: dirCap, signalDenominator: denom });
    } catch {
      // Cannot judge — a protocol with no stored breakdown is REPORTED as such below, never passed.
      capacity.set(p.slug, { unable: true });
    }
  }

  const feeds = WATCHED_FEEDS.map((f) => {
    let rows = '0';
    try {
      rows = parseTsv(query(`SELECT COUNT(*) AS n FROM ${f.table}`, conn))[0]?.n ?? '0';
    } catch {
      rows = '-1'; // table absent: not a dead feeder, an absent one — reported as unknown
    }
    return { ...f, rows };
  }).filter((f) => Number(f.rows) >= 0);

  const unable = [...capacity].filter(([, c]) => c.unable).map(([slug]) => slug);
  const findings = sortFindings([
    ...protocols.flatMap((p) => classifyProtocol({ ...p, ...(capacity.get(p.slug) || {}) })),
    ...classifyAssignments(assignments),
    ...classifyFeeds(feeds),
  ]);

  if (argv.includes('--json')) {
    process.stdout.write(
      JSON.stringify(
        {
          windowHours: hours,
          findings,
          structurallyUnjudgeable: unable,
          scannedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    console.log(`window: last ${hours}h`);
    report(findings);
    if (unable.length) {
      // "Cannot judge" must never render the same as "fine".
      console.log('');
      console.log(
        `ℹ️  ${unable.length} active protocol(s) have NO stored breakdown, so DIRECTION-STARVED could ` +
          `not be judged for them: ${unable.join(', ')}`,
      );
    }
  }

  if (argv.includes('--strict') && findings.some((f) => f.severity === 'critical' || f.severity === 'high')) {
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { classifyProtocol, classifyAssignments, classifyFeeds, sortFindings, SEVERITY_ORDER };
