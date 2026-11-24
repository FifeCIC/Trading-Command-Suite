#!/usr/bin/env node
/**
 * validate-parity-register.cjs — DOES THE BACKTEST RUN THE SAME MECHANISMS AS LIVE?
 *
 * ── WHY THIS EXISTS (owner requirement, 2026-11-24) ─────────────────────────────────────────────
 * A five-day backtest scored 4,000.94 and the question is whether it is genuinely the same system. Before
 * this, the answer was a prose table in an issue: it could not fail a build and no run could render it.
 * `nest/src/common/trading/parity-register.ts` is now the register, and this checks it against the SOURCE
 * on every build.
 *
 * ── WHAT IT ASSERTS, AND WHY BOTH DIRECTIONS MATTER ─────────────────────────────────────────────
 *
 *   shared      → the probe is present on BOTH sides                     (one implementation)
 *   gap         → present LIVE, ABSENT in the engine
 *   population  → present on both, and the row names what narrows it
 *   model       → present on both (they differ by measurement, not by existence)
 *
 * ⚠️ **THE ABSENCE HALF IS THE POINT.** A `gap` row fails when the engine STARTS referencing the
 * mechanism, because then the register is stale and keeps telling a reader a run cannot reproduce
 * something it now can. The opposite failure — a mechanism silently leaving the engine — fails the
 * `shared` and `population` rows. Either direction, the build goes red with the row named.
 *
 * ⚠️ **A COMMENT IS NOT A CALL.** Measured 2026-11-24: `trade-config.ts` names the live pyramiding
 * service in a NOTE STRING and imports nothing, so a bare-word search reports parity that does not exist.
 * Every probe is an import path, a called symbol, a setting key or a member access.
 *
 * ⚠️ **IT CANNOT READ THE SOURCE → exit 2 (cannot judge), never 0.** A check that inspects nothing and
 * reports OK is worse than no check.
 *
 * ── THE SELF-TEST CANARIES EVERY RULE IN BOTH DIRECTIONS ────────────────────────────────────────
 * `--self-test` builds fabricated registers and fabricated files and proves:
 *   · a shared row whose engine side is missing the probe      → FAIL
 *   · a gap row whose engine side GAINED the probe             → FAIL
 *   · a gap row whose live side is missing the probe           → FAIL
 *   · a population row missing a side                          → FAIL
 *   · a row probing a string that appears only in a COMMENT    → FAIL (this is the pyramid trap)
 *   · a fully consistent register                              → PASS
 *
 * Usage:
 *   node nest/scripts/validate-parity-register.cjs             # the real register
 *   node nest/scripts/validate-parity-register.cjs --report    # every row + where its probe was found
 *   node nest/scripts/validate-parity-register.cjs --self-test # prove every rule can fail
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTER = 'nest/src/common/trading/parity-register.ts';

/**
 * Parse the register out of the TypeScript source.
 *
 * ⚠️ IT IS PARSED, NOT IMPORTED. `ts-node` is not on this gate's path and the file is data — but a parse
 * can disagree with the module, so the parse is ASSERTED: every `id:` found in the source must appear in
 * the parsed set, and the parse fails loudly if a row yields no probes. A silent empty parse would make
 * every rule pass, which is the failure mode this whole family of scripts exists to prevent.
 */
function parseRegister(source) {
  const rows = [];
  const rowRe = /\{\s*\n\s*id:\s*'([^']+)',[\s\S]*?\n  \},/g;
  for (const m of source.matchAll(rowRe)) {
    const block = m[0];
    const id = m[1];
    const verdict = /verdict:\s*'([^']+)'/.exec(block)?.[1] ?? null;
    const mechanism = /mechanism:\s*'([^']*)'/.exec(block)?.[1] ?? id;
    const affectsOutcome = /affectsOutcome:\s*(true|false)/.exec(block)?.[1] === 'true';
    const sides = {};
    const sideRe = /\n    (backtest|live):\s*\{([\s\S]*?)\n    \},/g;
    for (const s of block.matchAll(sideRe)) {
      const body = s[2];
      const files = [...body.matchAll(/'([^']+\.ts)'/g)].map((f) => f[1]);
      const probe = /probe:\s*'([^']*)'/.exec(body)?.[1]
        // A probe written with double quotes (an import path inside a string literal).
        ?? /probe:\s*"([^"]*)"/.exec(body)?.[1]
        ?? null;
      sides[s[1]] = { files, probe };
    }
    rows.push({ id, mechanism, verdict, affectsOutcome, backtest: sides.backtest, live: sides.live });
  }
  return rows;
}

/** Does `probe` appear in any of `files`, and does it appear in CODE rather than only in a comment? */
function probeFound(files, probe) {
  if (!probe) return { found: false, where: [], onlyComment: false };
  const where = [];
  let onlyComment = true;
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue; // a missing file cannot satisfy a probe
    const src = fs.readFileSync(abs, 'utf8');
    if (!src.includes(probe)) continue;
    where.push(rel);
    // Strip comments and compare again: if the probe vanishes, it lived only in prose.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    if (code.includes(probe)) onlyComment = false;
  }
  return { found: where.length > 0, where, onlyComment: where.length > 0 && onlyComment };
}

/** Apply the rules to one row. Returns a list of failure strings. */
function checkRow(row, probeFoundImpl = probeFound) {
  const errors = [];
  const b = probeFoundImpl(row.backtest?.files ?? [], row.backtest?.probe);
  const l = probeFoundImpl(row.live?.files ?? [], row.live?.probe);

  if (row.verdict === 'shared') {
    if (!b.found) errors.push(`shared: the ENGINE does not reference '${row.backtest?.probe}' in ${row.backtest?.files?.join(', ') || '(no files)'} — the mechanism is not shared`);
    if (!l.found) errors.push(`shared: LIVE does not reference '${row.live?.probe}' in ${row.live?.files?.join(', ') || '(no files)'}`);
  } else if (row.verdict === 'gap') {
    if (!l.found) errors.push(`gap: LIVE does not reference '${row.live?.probe}' — the gap cannot be demonstrated, so the row is unproven`);
    if (b.found) errors.push(`gap CLOSED: the ENGINE now references '${row.backtest?.probe}' in ${b.where.join(', ')} — update the register to 'shared' (or 'population') and say so`);
  } else if (row.verdict === 'divergent') {
    // Both sides do it. A row that claimed a divergence and had a MISSING side would actually be a
    // `gap`, reported as a subtler problem than it is.
    if (!b.found) errors.push('divergent: the ENGINE does not reference ' + "'" + row.backtest?.probe + "'" + ' — this is a gap, not a divergence');
    if (!l.found) errors.push('divergent: LIVE does not reference ' + "'" + row.live?.probe + "'" + ' — the divergence cannot be demonstrated');
  } else if (row.verdict === 'population' || row.verdict === 'model') {
    if (!b.found) errors.push(`${row.verdict}: the ENGINE does not reference '${row.backtest?.probe}'`);
    if (!l.found) errors.push(`${row.verdict}: LIVE does not reference '${row.live?.probe}'`);
  } else {
    errors.push(`unknown verdict '${row.verdict}'`);
  }

  for (const [side, r] of [['engine', b], ['live', l]]) {
    if (r.onlyComment) {
      errors.push(`${side}: '${side === 'engine' ? row.backtest?.probe : row.live?.probe}' appears ONLY IN A COMMENT — a comment is not a call (this is the pyramid trap)`);
    }
  }
  return errors;
}

function main(argv) {
  const source = fs.existsSync(path.join(ROOT, REGISTER))
    ? fs.readFileSync(path.join(ROOT, REGISTER), 'utf8')
    : null;
  if (source == null) {
    console.error(`[parity] ❌ CANNOT JUDGE — ${REGISTER} does not exist, so nothing was checked.`);
    process.exit(2);
  }

  const rows = parseRegister(source);
  const declaredIds = [...source.matchAll(/\n    id:\s*'([^']+)',/g)].map((m) => m[1]);
  if (rows.length === 0 || rows.length !== declaredIds.length) {
    console.error(
      `[parity] ❌ CANNOT JUDGE — parsed ${rows.length} row(s) but the source declares ${declaredIds.length}. `
      + 'A partial parse would make every rule pass silently.',
    );
    process.exit(2);
  }
  for (const r of rows) {
    if (!r.backtest?.probe || !r.live?.probe) {
      console.error(`[parity] ❌ row '${r.id}' has no probe on one side — it would guard nothing.`);
      process.exit(1);
    }
  }

  if (argv.includes('--self-test')) {
    process.exit(selfTest(rows));
  }

  let failures = 0;
  for (const row of rows) {
    const errors = checkRow(row);
    if (argv.includes('--report')) {
      const b = probeFound(row.backtest.files, row.backtest.probe);
      const l = probeFound(row.live.files, row.live.probe);
      const mark = errors.length ? '✖' : '✅';
      console.log(`${mark} ${row.id.padEnd(14)} ${row.verdict.padEnd(11)} engine:${b.found ? 'yes' : 'no '} live:${l.found ? 'yes' : 'no '}  ${row.mechanism}`);
    }
    for (const e of errors) {
      console.error(`[parity] ✖ ${row.id}: ${e}`);
      failures += 1;
    }
  }

  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const gaps = rows.filter((r) => r.affectsOutcome && r.verdict !== 'shared');
  if (failures) {
    console.error(`\n[parity] ❌ ${failures} finding(s) across ${rows.length} row(s).`);
    process.exit(1);
  }
  console.log(
    `[parity] ✅ OK — ${rows.length} mechanisms checked against the source: `
    + `${count('shared')} shared exactly · ${count('divergent')} divergent (both sides, different rules) · `
    + `${count('population')} population (gated) · ${count('model')} modelled · ${count('gap')} absent from the engine.`,
  );
  console.log(
    `[parity]    ${gaps.length} mechanism(s) that change an outcome are not shared verbatim: `
    + `${gaps.map((g) => g.id).join(', ')}. A run describes the engine rules, not the account.`,
  );
  process.exit(0);
}

/** Fabricated cases, both directions, each one expected to fail for its OWN stated reason. */
function selfTest(rows) {
  const pass = (files, probe) => probeFound(files, probe);
  const cases = [
    {
      name: 'a consistent register passes',
      row: rows[0],
      impl: pass,
      expectFail: false,
    },
    {
      name: 'shared row: the engine side lost the probe',
      row: { id: 'x', verdict: 'shared', affectsOutcome: true, backtest: { files: ['package.json'], probe: 'definitely-not-here-xyz' }, live: { files: ['package.json'], probe: 'name' } },
      impl: pass,
      expectFail: true,
    },
    {
      name: 'gap row: the engine GAINED the mechanism (register is stale)',
      row: { id: 'x', verdict: 'gap', affectsOutcome: true, backtest: { files: ['package.json'], probe: 'name' }, live: { files: ['package.json'], probe: 'name' } },
      impl: pass,
      expectFail: true,
    },
    {
      name: 'gap row: the live side cannot demonstrate the gap',
      row: { id: 'x', verdict: 'gap', affectsOutcome: true, backtest: { files: ['package.json'], probe: 'definitely-not-here-xyz' }, live: { files: ['package.json'], probe: 'definitely-not-here-xyz' } },
      impl: pass,
      expectFail: true,
    },
    {
      name: 'population row: a side is missing',
      row: { id: 'x', verdict: 'population', affectsOutcome: true, backtest: { files: ['package.json'], probe: 'name' }, live: { files: ['package.json'], probe: 'definitely-not-here-xyz' } },
      impl: pass,
      expectFail: true,
    },
    {
      name: 'a probe satisfied ONLY by a comment is refused',
      row: { id: 'x', verdict: 'shared', affectsOutcome: true, backtest: { files: ['.parity-selftest-comment.ts'], probe: 'ONLY_IN_A_COMMENT_TOKEN' }, live: { files: ['package.json'], probe: 'name' } },
      impl: pass,
      expectFail: true,
    },
    {
      name: 'divergent row: a MISSING side is reported as a gap, not as a divergence',
      row: { id: 'x', verdict: 'divergent', affectsOutcome: true, backtest: { files: ['package.json'], probe: 'definitely-not-here-xyz' }, live: { files: ['package.json'], probe: 'name' } },
      impl: pass,
      expectFail: true,
    },
    {
      name: 'divergent row: both sides present passes',
      row: { id: 'x', verdict: 'divergent', affectsOutcome: true, backtest: { files: ['package.json'], probe: 'name' }, live: { files: ['package.json'], probe: 'name' } },
      impl: pass,
      expectFail: false,
    },
    {
      name: 'an unknown verdict is refused',
      row: { id: 'x', verdict: 'probably-fine', affectsOutcome: true, backtest: { files: ['package.json'], probe: 'name' }, live: { files: ['package.json'], probe: 'name' } },
      impl: pass,
      expectFail: true,
    },
  ];

  // The comment-only fixture. Written here and removed in a `finally` — a canary that leaves the tree
  // modified is worse than no canary.
  const fixture = path.join(ROOT, '.parity-selftest-comment.ts');
  let failed = 0;
  try {
    fs.writeFileSync(fixture, '// ONLY_IN_A_COMMENT_TOKEN — a comment is not a call\nexport const nothing = 1;\n');
    for (const c of cases) {
      const errors = checkRow(c.row, c.impl);
      const actualFail = errors.length > 0;
      const ok = actualFail === c.expectFail;
      if (!ok) {
        failed += 1;
        console.error(`[parity:self-test] ✖ ${c.name} — expected ${c.expectFail ? 'FAIL' : 'PASS'}, got ${actualFail ? 'FAIL' : 'PASS'}`);
        if (errors.length) console.error('    first error: ' + errors[0]);
      } else {
        console.log(`[parity:self-test] ✅ ${c.name}`);
      }
    }
  } finally {
    if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
  }

  if (failed) {
    console.error(`[parity:self-test] ❌ ${failed} case(s) did not behave — the guard does not guard.`);
    process.exit(1);
  }
  console.log(`[parity:self-test] ✅ ${cases.length} cases, both directions, every rule observed to fail.`);
  process.exit(0);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { parseRegister, probeFound, checkRow };
