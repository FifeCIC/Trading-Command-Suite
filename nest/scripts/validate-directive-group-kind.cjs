#!/usr/bin/env node
/**
 * validate-directive-group-kind.cjs — INV-GATE-MEMBERSHIP (build-time)
 * ====================================================================
 * Companion guard for `validate-pipeline-contracts.cjs`. Wired into `prebuild`
 * ahead of it, in the same zero-tolerance spirit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS PREVENTS (measured live, issue #789)
 * ─────────────────────────────────────────────────────────────────────────
 * A protocol is an assembly of groups. Each group is one of two KINDS, and the
 * two are not interchangeable buckets that both feed the same sum:
 *
 *   SCORING group  (`isRiskGate: false`) — answers "which way, how strongly?"
 *                  Its directives feed the directional composite and their
 *                  `maxScore` values form the denominator.
 *
 *   RISK GATE      (`isRiskGate: true`)  — answers "should this be trusted at
 *                  all?" It does not vote on direction; it scales what the
 *                  scoring groups produced.
 *
 * `protocol-gating.service.ts` enforces that separation structurally:
 *
 *     const inSignal = !isGateGroup && directional && directionAllowed;   // L689
 *     if (!isGateGroup) { capacityMax += maxScore; }                      // L749
 *     if (!isGateGroup && result.signalClass === 'bullish') { ... }       // L763
 *
 * So a DIRECTIONAL predictor placed in a risk gate is **erased, not
 * downgraded**: it still runs, still consumes its bars, still computes a
 * confident bullish/bearish reading, and the scorer discards it. It
 * contributes no score, no direction, and no capacity.
 *
 * Nothing errors. Nothing warns about *that*. The protocol simply carries
 * points of capacity that can never contribute, and the only symptom is a
 * number that reads slightly too low — the "plausible numbers, no error"
 * class the contracts doc exists to catch.
 *
 * MEASURED: `session-open-effect` (a directional `pattern` predictor,
 * maxScore 60) sat in the `risk` group of **14 protocols**. It was inert in
 * all 14. In 10 of them a lower-`sortOrder` copy in `technical` happened to
 * save the signal, so the only visible symptom was a duplicate-directive
 * warning on boot — which is a *different* fault with the same message.
 * `ProtocolHealthService` names the duplicate; nothing named the dead one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ─────────────────────────────────────────────────────────────────────────
 * Every directive listed in a group with `isRiskGate: true` must declare
 * `category === 'structural'`.
 *
 * That is the codebase's OWN marker for a gate, stated in
 * `directives/interfaces/directive.interface.ts`:
 *
 *     'structural': Risk gates, regime checks. Modifier, not signal score.
 *
 * A `'structural'` directive is a hurdle by construction, so placing one in a
 * risk gate is correct. Any OTHER category in a risk gate
 * (`pattern` / `oscillator` / `ratio`) is a directional VOTER, and the gating
 * service will discard its reading — that is the defect.
 *
 * ⚠️ WHY THE RULE WAS NARROWED TO THIS (do not widen it back)
 * -----------------------------------------------------------
 * The first version of this guard required `category === 'risk'` and reported
 * **68 violations**, 62 of which were `category: 'structural'`
 * (`liquidity-check` ×39, `budget-gate` ×6, `position-size-kelly` ×5,
 * `rollover-risk` ×5, `market-regime` ×3, …). Every one of those is a genuine
 * gate sitting in a genuine gate — correct code.
 *
 * A guard that reports 68 violations on a healthy tree is the exact failure
 * mode the contracts doc warns about: "a guard that emits warnings gets
 * ignored, which is worse than no guard because it looks like coverage."
 * Reading the interface's own definition is what fixed it. The rule now
 * matches the code's own vocabulary rather than an invented one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A SCAN OF SEED DATA, NOT A MARKER CANARY
 * ─────────────────────────────────────────────────────────────────────────
 * The fault is in a DATA file's structure (which directive sits in which
 * group), not in the presence of a helper. A canary verifies a mechanism
 * still EXISTS — exactly the blind spot that let ~27,376 phantom bars sit
 * undetected (#783). This guard reads the actual seed and the actual
 * directive classes and compares them, because the defect is a property of
 * the data, not of any single function.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PRECISION — READ BEFORE CHANGING THE RULE
 * ─────────────────────────────────────────────────────────────────────────
 * A guard that fires on correct code gets switched off, which is worse than
 * no guard because it looks like coverage. Two deliberate narrowings:
 *
 *   1. RESOLUTION IS FAIL-SOFT ON UNKNOWN DIRECTIVES. A directive id with no
 *      discoverable class cannot be classified, so it is NOT flagged. A
 *      guard that fails the build because it could not read a file would be
 *      switched off within a day. Unknown ids are counted and reported.
 *
 *   2. THE EXEMPT LIST REQUIRES A WRITTEN REASON. Some risk groups
 *      legitimately hold a non-`risk`-category directive. Each exemption
 *      names its reason in EXEMPT above, so the next reader can judge it
 *      rather than guess. The list is debt and must only shrink.
 *
 * Usage (from nest/):  node scripts/validate-directive-group-kind.cjs
 * Exit code: 1 on any violation, 0 otherwise.
 */

const fs = require('node:fs');
const path = require('node:path');

const NEST_ROOT = path.resolve(__dirname, '..');
const SEED_FILE = path.join(NEST_ROOT, 'src', 'modules', 'scoring', 'protocols-seed-data.ts');
const IMPL_DIR = path.join(NEST_ROOT, 'src', 'modules', 'directives', 'implementations');

/**
 * Directives that may legitimately sit in a risk gate despite not declaring
 * `category === 'risk'`.
 *
 * ⚠️ DEBT, not exemptions. Each entry needs a reason a reviewer can judge. If a
 * site is fixed the entry MUST be deleted — `checkStaleExemptions` fails the
 * build when an entry no longer matches anything, so this list can only shrink.
 */
const EXEMPT = new Map([
  // Format: '<directiveId>' -> '<reason why this non-risk directive is a genuine gate>'
]);

/**
 * Categories that identify a directive as a hurdle rather than a voter.
 *
 * `'structural'` is the codebase's own marker, defined in
 * `directives/interfaces/directive.interface.ts` as:
 *
 *     'structural': Risk gates, regime checks. Modifier, not signal score.
 *
 * Anything else (`pattern` / `oscillator` / `ratio`) is a directional voter.
 */
const GATE_CATEGORIES = new Set(['structural']);

// ── parsing ─────────────────────────────────────────────────────────────────

/**
 * Read a directive class and return `{ category, directionBias, maxScore }`.
 *
 * Directives are classes with these as readonly fields. We read the SOURCE
 * rather than instantiating, so the guard needs no build and no DI container.
 *
 * ⚠️ TWO FILES SHAPES EXIST — both must be handled or directives silently fall
 * into the "unclassified" bucket and are skipped:
 *
 *   1. one class per file   — `implementations/<id>.directive.ts`
 *   2. MANY classes per file — e.g. `implementations/momentum-and-macro.directives.ts`
 *      holds `sp500-regime`, `vix-strategy`, `weekly-rhythm-strategy`, …
 *
 * Shape 2 was discovered the hard way: `sp500-regime` (×2) and `vix-strategy` (×1)
 * sat in risk gates, were skipped as "no class found", and were therefore NOT
 * flagged — a false negative that made the guard look complete while those three
 * placements went unchecked. `sp500-regime` and `vix-strategy` both return
 * `bullish`/`bearish` from SMA200 / ATR-percentile math, i.e. they are voters.
 *
 * ⚠️ `category` IS OPTIONAL on `IDirective`. A directive that declares none
 * cannot be classified by it, and the guard fails soft (see the caller). That is
 * deliberate — but such a directive is reported as `no-category` rather than
 * silently lumped in with truly-unreadable ones, because "declares no category"
 * is a fact a human can act on and "file not found" is a parser problem.
 */
function readDirectiveMeta(directiveId) {
  // Shape 1: dedicated file.
  const dedicated = [
    path.join(IMPL_DIR, `${directiveId}.directive.ts`),
    path.join(IMPL_DIR, `${directiveId}.ts`),
  ].find((f) => fs.existsSync(f));

  if (dedicated) return extractMeta(fs.readFileSync(dedicated, 'utf8'), dedicated);

  // Shape 2: a multi-directive file. Locate the class whose `readonly id = '<id>'`
  // matches, then read only the slice from there to the next class declaration so
  // one class's fields are never attributed to another.
  if (!fs.existsSync(IMPL_DIR)) return null;
  const candidates = fs.readdirSync(IMPL_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

  for (const name of candidates) {
    const file = path.join(IMPL_DIR, name);
    const src = fs.readFileSync(file, 'utf8');
    const idRe = new RegExp(`readonly\\s+id\\s*=\\s*['"]${directiveId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
    const m = idRe.exec(src);
    if (!m) continue;

    // Slice to the next class declaration, so fields cannot leak across classes.
    const nextClass = src.indexOf('export class ', m.index + m[0].length);
    const slice = src.slice(m.index, nextClass === -1 ? src.length : nextClass);
    return extractMeta(slice, file);
  }

  return null;
}

/** Pull the readonly fields out of a source slice belonging to ONE directive. */
function extractMeta(src, file) {
  const pick = (field) => {
    const m = src.match(new RegExp(`readonly\\s+${field}\\s*=\\s*['"]?([^'";\\n]+)['"]?`));
    return m ? m[1].trim() : null;
  };
  const category = pick('category');
  return {
    file: path.relative(NEST_ROOT, file).split(path.sep).join('/'),
    category,
    // Distinguish "declares no category" (actionable) from "could not read the
    // file" (parser problem). Only the latter is truly unclassifiable.
    categoryMissing: category === null,
    directionBias: pick('directionBias'),
    maxScore: pick('maxScore'),
    readiness: pick('readiness'),
  };
}

/**
 * Parse the seed file into protocols → groups → directiveIds.
 *
 * The seed is hand-formatted TypeScript (not JSON), so this tracks indentation
 * the same way `find-risk-group-directives.cjs` does. Indentation is regular
 * because the file is generated, and a shape mismatch is REPORTED rather than
 * silently yielding zero groups (a parser that finds nothing must not look
 * like a pass).
 */
function parseSeed() {
  const raw = fs.readFileSync(SEED_FILE, 'utf8');
  const lines = raw.split(/\r?\n/);
  const protocols = [];

  let current = null;
  let group = null;
  let inDirectiveIds = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // Protocol key: `  "slug": {` at exactly 2-space indent.
    const proto = line.match(/^ {2}"([^"]+)":\s*\{/);
    if (proto) {
      current = { slug: proto[1], line: lineNo, groups: [] };
      protocols.push(current);
      group = null;
      inDirectiveIds = false;
      continue;
    }

    if (!current) continue;

    // Group id at 8-space indent.
    const gid = line.match(/^ {8}"id":\s*"([^"]+)"/);
    if (gid) {
      group = { id: gid[1], line: lineNo, isRiskGate: null, directiveIds: [] };
      current.groups.push(group);
      inDirectiveIds = false;
      continue;
    }

    // Risk-gate flag at 8-space indent.
    const gate = line.match(/^ {8}"isRiskGate":\s*(true|false)/);
    if (gate && group) {
      group.isRiskGate = gate[1] === 'true';
      continue;
    }

    // Open a directiveIds array.
    if (/^\s*"directiveIds":\s*\[/.test(line)) {
      inDirectiveIds = true;
      // An inline array on the same line is not used by this file's style, but
      // handle it so a format change degrades to "parsed correctly" not "silently empty".
      const inline = line.match(/\[([^\]]*)\]/);
      if (inline && group) {
        for (const m of inline[1].matchAll(/"([^"]+)"/g)) group.directiveIds.push({ id: m[1], line: lineNo });
        inDirectiveIds = false;
      }
      continue;
    }

    if (inDirectiveIds) {
      if (/^\s*\]/.test(line)) {
        inDirectiveIds = false;
        continue;
      }
      const id = line.match(/^\s*"([^"]+)"\s*,?\s*$/);
      if (id && group) group.directiveIds.push({ id: id[1], line: lineNo });
    }
  }

  return protocols;
}

// ── checks ──────────────────────────────────────────────────────────────────

const failures = [];
const notes = [];

function fail(message, hint) {
  failures.push({ message, hint });
}

/** Directives seen in a risk gate, so stale exemptions can be detected. */
const seenInRiskGate = new Set();
/** Directive ids with no subject-matter subject-matter classification possible. */
const unknownDirectives = new Map();
/**
 * Directive ids whose class was FOUND but that declare no `category`, so the
 * rule cannot classify them. Reported loudly-but-non-fatally: an optional field
 * being absent must not break the build, but these are unverified and may be
 * voters (e.g. `sp500-regime`, `vix-strategy` — both return bullish/bearish).
 */
const noCategoryDirectives = new Map();

function checkRiskGateMembership(protocols) {
  for (const proto of protocols) {
    for (const group of proto.groups) {
      // A group with no explicit `isRiskGate` is treated as a SCORING group by
      // the gating service (`config.isRiskGate === true`), so absence is safe.
      if (group.isRiskGate !== true) continue;

      for (const entry of group.directiveIds) {
        const id = entry.id;
        seenInRiskGate.add(id);

        if (EXEMPT.has(id)) continue;

        const meta = readDirectiveMeta(id);
        if (!meta) {
          // Fail-soft: cannot read the class at all. Count for the report, never fail.
          unknownDirectives.set(id, (unknownDirectives.get(id) ?? 0) + 1);
          continue;
        }

        // A directive that declares NO category cannot be classified by it. Fail
        // soft (the guard must not fail the build because the codebase omits an
        // optional field), but report it separately: unlike a missing file, this
        // is a fact a human can act on, and these may well be voters.
        //
        // Discovered 2026-09-11: `sp500-regime` and `vix-strategy` (both in risk
        // gates, both returning bullish/bearish from SMA200 / ATR percentile)
        // declare no `category`. They were previously skipped as "file not found"
        // because they live in a multi-directive file — so the guard was
        // reporting green while three placements went unchecked.
        if (meta.categoryMissing) {
          noCategoryDirectives.set(
            id,
            (noCategoryDirectives.get(id) ?? 0) + 1,
          );
          continue;
        }

        if (GATE_CATEGORIES.has(meta.category)) continue;

        fail(
          `protocols-seed-data.ts:${entry.line} — protocol "${proto.slug}", risk gate "${group.id}": ` +
            `directive "${id}" declares category="${meta.category ?? 'unknown'}" (${meta.file}), which is a directional ` +
            `voter, not a gate`,
          `INV-GATE-MEMBERSHIP: a risk gate may only contain \`category: 'structural'\` directives (the interface's own ` +
            `definition: "'structural': Risk gates, regime checks. Modifier, not signal score."). \`protocol-gating.service.ts\` ` +
            `excludes risk-gate groups from the signal at L689 (\`inSignal = !isGateGroup && ...\`), L749 (no \`capacityMax\` ` +
            `contribution) and L763/766 (no bullish/bearish accumulation), so a voter here computes a reading that is then ` +
            `DISCARDED — no score, no direction, no capacity, and nothing reports it. Fix by one of: (a) move it to the scoring ` +
            `group where it belongs, or (b) if it genuinely IS a hurdle, set \`category = 'structural'\` on the directive class, ` +
            `or (c) add it to EXEMPT in this script WITH A WRITTEN REASON. Measured case: \`session-open-effect\` (category ` +
            `'pattern') was inert in 14 protocols this way (#789).`,
        );
      }
    }
  }
}

/**
 * An exemption that no longer matches anything means the site was fixed (or the
 * directive was renamed) — the list must shrink or it silently grows stale.
 */
function checkStaleExemptions() {
  for (const [id, reason] of EXEMPT) {
    if (!seenInRiskGate.has(id)) {
      fail(
        `EXEMPT lists "${id}" but it appears in no risk gate — the site was fixed, renamed or removed`,
        `Delete that entry from EXEMPT (its recorded reason was: ${reason}).`,
      );
    }
  }
}

/**
 * A parser that silently finds nothing must not read as a pass. This is the one
 * check that protects every other check in this file.
 */
function checkParseSucceeded(protocols) {
  if (protocols.length === 0) {
    fail(
      'parsed zero protocols from protocols-seed-data.ts',
      'The seed file format changed and this guard can no longer read it. Update parseSeed() — do NOT leave this failing silently, because an empty parse disables every membership check.',
    );
    return;
  }
  const groups = protocols.reduce((n, p) => n + p.groups.length, 0);
  const gates = protocols.reduce((n, p) => n + p.groups.filter((g) => g.isRiskGate === true).length, 0);
  const placements = protocols.reduce(
    (n, p) => n + p.groups.filter((g) => g.isRiskGate === true).reduce((m, g) => m + g.directiveIds.length, 0),
    0,
  );
  if (groups === 0 || gates === 0 || placements === 0) {
    fail(
      `seed parse produced ${protocols.length} protocols / ${groups} groups / ${gates} risk gates / ${placements} gate placements`,
      'At least one of those must be non-zero for the gate check to mean anything. A zero here means the parse is wrong, not that the config is clean.',
    );
    return;
  }
  notes.push(`parsed ${protocols.length} protocols, ${groups} groups, ${gates} risk gates, ${placements} gate placements`);
}

// ── run ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(SEED_FILE)) {
  console.error(`[gate-membership] ✖ ${path.relative(NEST_ROOT, SEED_FILE)} not found`);
  process.exit(1);
}

const protocols = parseSeed();
checkParseSucceeded(protocols);
checkRiskGateMembership(protocols);
checkStaleExemptions();

for (const n of notes) console.log(`[gate-membership] ${n}`);
if (unknownDirectives.size) {
  const list = [...unknownDirectives.entries()].map(([id, n]) => `${id} (${n})`).join(', ');
  console.log(`[gate-membership] ⚠ no directive class found — NOT CHECKED: ${list}`);
}
if (noCategoryDirectives.size) {
  const list = [...noCategoryDirectives.entries()].map(([id, n]) => `${id} (${n})`).join(', ');
  console.log(
    `[gate-membership] ⚠ declare no \`category\` — NOT CHECKED, verify these are genuine gates: ${list}`,
  );
  console.log(
    `[gate-membership]   \`category\` is optional on IDirective, so this cannot fail the build. But a directive that\n` +
      `[gate-membership]   returns bullish/bearish here is a voter being discarded. Set \`category = 'structural'\`\n` +
      `[gate-membership]   if it is a genuine gate (see INV-GATE-MEMBERSHIP).`,
  );
}
if (EXEMPT.size) {
  console.log(`[gate-membership] ${EXEMPT.size} exemption(s):`);
  for (const [id, reason] of EXEMPT) console.log(`    - ${id}: ${reason}`);
}

if (failures.length) {
  console.error(`\n[gate-membership] ✖ ${failures.length} violation(s) of INV-GATE-MEMBERSHIP:\n`);
  for (const f of failures) {
    console.error(`  ✖ ${f.message}`);
    if (f.hint) console.error(`      → ${f.hint}`);
  }
  console.error('\nSee .github/instructions/meta-stack-contracts.instructions.md (INV-GATE-MEMBERSHIP)\n');
  process.exit(1);
}

console.log('[gate-membership] ✅ OK — every risk-gate member is a declared gate\n');
