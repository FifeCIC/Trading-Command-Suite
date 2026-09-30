#!/usr/bin/env node
/**
 * validate-single-bridge-position-io.cjs — INV-POSITION-IO-IS-BROKER-ADDRESSED (build-time)
 * =========================================================================================
 *
 * Fails the build when a service that manages positions addresses ONE bridge.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE DEFECT (#1030)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `Mt5ConnectionManager.getUrl()` **with no argument returns the PRIMARY bridge**. With
 * `MT5_ACTIVE_BROKERS=2,3` that is MetaQuotes `:5000`; Pepperstone `:5001` is a second, equally
 * live account that nothing will ever mention. So a service that captures one URL and uses it for
 * every read and write is not "slightly wrong" — it is silently scoped to one of two accounts.
 *
 * MEASURED LIVE 2026-09-30, BEFORE the fix:
 *
 *     :5000 (broker 2) -> 7 positions
 *     :5001 (broker 3) -> 2 positions (US500, GER40)
 *     Guardian, every tick:  "7 guarded"
 *
 * Those two positions had never been trailed or time-stopped. And GER40 was invisible TWICE over:
 * `GET :5000/candles?symbol=GER40` answers **200 with ZERO bars** while `:5001` answers with data,
 * so even had the position been seen, the tick would have skipped it on `bars.length < 14` —
 * leaving no error anywhere, just a smaller number that looked like a normal result.
 *
 * ⚠️ THE FIX WAS NOT A SECOND URL. `Mt5ConnectionManager` ALREADY had `getAllPositions()`,
 * `getCandles(…, brokerId)` and `modifyOrder(…, brokerId)`. Both services hand-rolled their own
 * `fetch` against a single URL instead, so they inherited none of the manager's routing. The bug
 * was **a duplicate of the shared core**, which is why the shared core could not protect them.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ SCOPE, STATED RATHER THAN IMPLIED
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Rule 2 (no-argument `getUrl()`) is scanned across ALL of `nest/src`, because that expression
 * means "the primary bridge" wherever it appears and there is no context in which its intent is
 * ambiguous. Rules 1 and 3 are scanned across `nest/src/modules/automation`, which is where the
 * position MANAGERS live.
 *
 * ⚠️ KNOWN INSTANCES OUTSIDE THIS GUARD, NOT HIDDEN BY IT — the same class also exists on the
 * READ path (`providers/mt5.controller.ts` `GET /api/mt5/positions` and its close-all loop, and
 * `trading/mt5-trading.service.ts` `getPositions()`). Those are display/fallback reads rather than
 * exit management, and they are deliberately NOT in #1030's scope or in this guard's exception
 * list: a broad exemption is how a guard stops being one. They are declared below as
 * `DECLARED_READ_PATH_INSTANCES` and tracked by their own issue.
 *
 * ⚠️ TWO FURTHER BLIND SPOTS, stated so they are facts rather than surprises:
 *   · `mt5.controller.ts` binds a module-level `BRIDGE_URL` constant (`resolveMt5BridgeUrl()`)
 *     rather than calling `getUrl()`, so rule 2 cannot see it. Detecting it would mean matching on
 *     a variable NAME, which is guesswork and would fire on unrelated code.
 *   · A bridge captured into a local (`const url = this.bridgeUrl;`) reads the FIELD, not a call,
 *     so only rule 1 (the field itself) catches it — and only inside `automation/`.
 *   Both are covered by the issue that owns the read path, not by a widened pattern here.
 *
 * Usage:
 *   node nest/scripts/validate-single-bridge-position-io.cjs              # check (build gate)
 *   node nest/scripts/validate-single-bridge-position-io.cjs --self-test  # prove it can fail
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
// ⚠️ SHARED SOURCE-SHAPE BLOCKS (#1030). This guard was written by copying
// `validate-signal-classification.cjs`, and the duplication validator failed the build on 8 shared
// blocks. This repo's rule is EXTRACT, never bank: banking removes the complaint, extracting removes
// the class. Anything guard-SPECIFIC stays here.
const {
  runCases,
  stripComments,
  walkSourceFiles,
} = require('../../scripts/lib/validator-helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'nest', 'src');

/**
 * `getUrl()` with NO argument = the PRIMARY bridge. Addressing anything by this is the defect.
 *
 * ⚠️ The `\s*` is deliberate: `getUrl( )` is the same call. `getUrl(3)` is fine — an EXPLICIT id is
 * checked against the registry and THROWS for an unregistered broker (#914), so it cannot silently
 * fall back to the wrong account.
 */
const NO_ARG_GETURL = /\.getUrl\(\s*\)/;

/** The single-URL field these services used to hold. The URL itself is the defect, not its name. */
const BRIDGE_URL_FIELD = /\bbridgeUrl\b/;

/** A broker-less position read, matched only on the connection manager's receiver. */
const NO_ARG_GETPOSITIONS = /\.getPositions\(\s*\)/;

/** The canonical multi-broker accessors. A line using one of these is never a finding. */
const CANONICAL = /getAllPositions\s*\(\s*\)|getCandles\s*\(|modifyOrder\s*\(|closePosition\s*\(/;

/**
 * ⚠️ LINE-ANCHORED EXCEPTIONS — deliberately NOT file-wide.
 *
 * A file-wide exemption in `mt5-trading.service.ts` would also hide the NEXT no-argument `getUrl()`
 * added anywhere in that file, and that file is a hotspot with nine consumers. An exception
 * therefore names the file AND a substring the offending LINE must contain, so it exempts exactly
 * one statement, expires by itself if the line is rewritten, and cannot spread.
 *
 * Each entry carries a reason and the issue that removes it.
 */
const EXCEPTIONS = [
  {
    file: 'nest/src/modules/trading/mt5-trading.service.ts',
    contains: 'return this.mt5Connection.getUrl();',
    reason:
      'The `bridgeUrl` getter resolves the PRIMARY account deliberately, and `getAccount()` is ' +
      'genuinely a primary-account read. It is the getter\'s OTHER consumer — `getPositions()` — ' +
      'that is primary-only, and swapping it is not a two-line change: nine consumers, several of ' +
      'them money-adjacent, would all change at once. Filed rather than drive-by\'d.',
    issue: '#1033',
  },
];

/**
 * The same class on the READ path. Listed so the blind spot is a stated fact rather than an
 * omission — a reader can see exactly what this guard does not cover.
 */
const DECLARED_READ_PATH_INSTANCES = [
  'nest/src/modules/providers/mt5.controller.ts — GET /api/mt5/positions and the close-all loop',
  'nest/src/modules/trading/mt5-trading.service.ts — getPositions() via the bare bridgeUrl getter',
];

/** Findings for one source string. `rel` decides which rules apply. Pure, so the self-test drives it. */
function scanSource(src, rel) {
  const out = [];
  const clean = stripComments(src);
  const inAutomation = /\/modules\/automation\//.test(`/${rel}`);
  const exemptions = EXCEPTIONS.filter((e) => e.file === rel);
  /** An exception must match the LINE, so it cannot cover a sibling statement. */
  const isExempt = (line) => exemptions.some((e) => line.includes(e.contains));

  for (const line of clean.split(/\r?\n/)) {
    const text = line.trim();

    // ⚠️ ONE FINDING PER LINE, and the ORDER is deliberate. `this.bridgeUrl = this.mt5Connection
    // .getUrl();` — the shipped line — matches BOTH the field rule and the no-arg rule, and
    // reporting it twice makes one defect look like two. The narrower automation rules are
    // therefore tried first and `continue` on a hit.
    if (inAutomation) {
      // Rule 1 — a single-URL field.
      if (BRIDGE_URL_FIELD.test(line) && !CANONICAL.test(line)) {
        out.push({ rel, rule: 'single bridgeUrl field', text: text.slice(0, 120) });
        continue;
      }

      // Rule 3 — a broker-less position read on the connection manager.
      //
      // ⚠️ The `mt5Connection` receiver test is what keeps this NARROW. `adapter.getPositions()` on
      // a per-broker adapter (automation-loop.service.ts) is CORRECT — the adapter is already
      // scoped — and flagging it would make this guard fire on the one pattern that does it right.
      if (NO_ARG_GETPOSITIONS.test(line) && /mt5Connection/.test(line) && !CANONICAL.test(line)) {
        out.push({ rel, rule: 'broker-less getPositions()', text: text.slice(0, 120) });
        continue;
      }
    }

    // Rule 2 — the primary bridge, addressed by omission. ANY file.
    if (NO_ARG_GETURL.test(line) && !CANONICAL.test(line)) {
      if (!isExempt(line)) out.push({ rel, rule: 'no-arg getUrl()', text: text.slice(0, 120) });
    }
  }
  return out;
}

function scanTree() {
  const findings = [];
  for (const full of walkSourceFiles(SRC)) {
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    findings.push(...scanSource(fs.readFileSync(full, 'utf8'), rel));
  }
  return findings;
}

function selfTest() {
  const AUT = 'nest/src/modules/automation/position-time-stop.service.ts';
  const TRD = 'nest/src/modules/trading/mt5-trading.service.ts';
  const CTRL = 'nest/src/modules/providers/mt5.controller.ts';

  const cases = [
    // ── the SHIPPED defect, verbatim in shape ───────────────────────────────────────────────
    ['flags the single-URL field the guardian held (#1030)',
      () => scanSource(`  private readonly bridgeUrl: string;`, AUT).length === 1],
    ['flags resolving one URL in the constructor (#1030)',
      () => scanSource(`    this.bridgeUrl = this.mt5Connection.getUrl();`, AUT).length === 1],
    ['flags a broker-less getPositions() on the connection manager',
      () => scanSource(`    const raw = await (this.mt5Connection as any).getPositions();`, AUT).length === 1],
    ['flags a no-arg getUrl() at ANY path in nest/src, not just automation',
      () => scanSource(`    return this.mt5Connection.getUrl();`, CTRL).length === 1],

    // ── must NOT fire: the false positives that would get this guard allowlisted ────────────
    ['does NOT flag getAllPositions()',
      () => scanSource(`    const positions = await this.mt5Connection.getAllPositions();`, AUT).length === 0],
    ['does NOT flag a broker-ADDRESSED getPositions(brokerId)',
      () => scanSource(`    const p = await (this.mt5Connection as any).getPositions(brokerId);`, AUT).length === 0],
    ['does NOT flag a broker-ADDRESSED getUrl(brokerId)',
      () => scanSource(`      if (this.mt5Connection.isBroker(id)) return this.mt5Connection.getUrl(id);`, AUT).length === 0],
    ['does NOT flag a per-broker ADAPTER read — the pattern that is already correct',
      () => scanSource(`          const result = await adapter.getPositions();`, AUT).length === 0],
    ['does NOT flag broker-addressed candles or a modify',
      () => scanSource(`    const own = await this.mt5Connection.getCandles(symbol, '5m', 30, brokerId);`, AUT).length === 0],
    ['does NOT flag the defect described in a line comment',
      () => scanSource(`    // #1030 — this used to be this.bridgeUrl = this.mt5Connection.getUrl();`, AUT).length === 0],
    ['does NOT flag the defect described in a docblock',
      () => scanSource('/**\n * getUrl() with no argument returns the PRIMARY bridge.\n * It used to be this.bridgeUrl = this.mt5Connection.getUrl();\n */', AUT).length === 0],

    // ── the declared exception, and proof it is NARROW ──────────────────────────────────────
    ['the declared exception exempts the line it names (#1033)',
      () => scanSource(`    return this.mt5Connection.getUrl();`, TRD).length === 0],
    ['⚠️ the exception does NOT cover a DIFFERENT no-arg getUrl() in the same file',
      () => scanSource(`    return this.mt5Connection.getUrl();\n    const other = this.mt5Connection.getUrl();`, TRD).length === 1],

    // ── the tree itself ─────────────────────────────────────────────────────────────────────
    ['the REAL tree is clean', () => scanTree().length === 0],
  ];

  process.exit(runCases(cases) ? 1 : 0);
}

if (process.argv.includes('--self-test')) selfTest();

const findings = scanTree();
if (findings.length) {
  console.log(`[single-bridge-position-io] ✖ ${findings.length} position I/O call(s) addressed to ONE bridge:\n`);
  for (const f of findings) console.log(`  ${f.rel}\n    [${f.rule}] ${f.text}\n`);
  console.log('  A position must be addressed by the ACCOUNT THAT HOLDS IT, not by a URL:');
  console.log('    const positions = await this.mt5Connection.getAllPositions();  // each row carries brokerId');
  console.log('    await this.mt5Connection.getCandles(symbol, \'5m\', 30, pos.brokerId);');
  console.log('    await this.mt5Connection.modifyOrder(ticket, sl, undefined, pos.brokerId);');
  console.log("  ⚠️ getUrl() with no argument is the PRIMARY bridge — with MT5_ACTIVE_BROKERS=2,3 that");
  console.log('     silently excludes the other account (#1030).');
  console.log('\n  Declared instances this guard does NOT cover (read path, tracked separately):');
  for (const d of DECLARED_READ_PATH_INSTANCES) console.log(`    · ${d}`);
  process.exit(1);
}
console.log('[single-bridge-position-io] ✅ OK — position I/O is addressed per broker');
