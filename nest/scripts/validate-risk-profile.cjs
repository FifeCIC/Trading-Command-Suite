#!/usr/bin/env node
/**
 * validate-risk-profile.cjs — every `PortfolioRisk` key must be DECLARED, and every LIVE cap must
 * be **movable by an operator**.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY (2026-09-17)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Six constants drive the portfolio risk gates. Measured that day, five of them were hardcoded
 * literals copied into four files, and nothing declared any of them:
 *
 *     `Allocation 62.7% exceeds max per symbol 25%`   — 78 blocked trades in one day
 *     ...and `maxPerSymbol: 0.25` appeared in 5 places, so even fixing one would not have fixed it.
 *
 * The cap itself was not wrong. The problem was that it was **invisible**: no declaration, no
 * setting, no UI, no log line naming where it came from. A risk cap an operator cannot find is a
 * cap that gets worked around rather than reviewed.
 *
 * This is the same shape as the 8 unenforced bot columns — and it is the check that would have
 * caught it on the day it was written.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IT CHECKS
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   1. Every scalar key of `interface PortfolioRisk` is declared in `RISK_CONSTANT_RULES`.
 *   2. Every declared field still exists in the interface (a removed key leaves a stale rule).
 *   3. `live` / `legacy-only` must name an `enforcedBy` file that EXISTS and REFERENCES the field.
 *   4. 🔑 **`enforcement: 'live'` with `settingKey: null` FAILS.** This is the rule that matters —
 *      it is the assertion "an operator can move a cap that can refuse their trades".
 *   5. Every `settingKey` exists in `settings-registry.ts`.
 *   6. A settings-backed constant's `defaultValue` must EQUAL the setting's declared default. Two
 *      copies of a number is how 25% ended up in five files.
 *   7. No `field: <number>` literal may appear outside `risk-profile-rules.ts` — one copy only.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHAT IT CANNOT DO — state this plainly, do not let it imply more
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * It is a STATIC check. It cannot prove the value is CORRECT, that the number fed into a cap was
 * computed properly, or that a gate fires at runtime. It would NOT have caught #865's arithmetic
 * defect (an inflated estimate forcing the cap to trip) — that needed a measurement against the live
 * account, and no validator can do it. Passing means **"every cap is declared, owned, and
 * operator-movable"** — not "every cap is right".
 *
 * Exit 0 = clean. Exit 1 = at least one finding (named). Refuses to report OK if it parsed nothing.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVICE = path.join(__dirname, '..', 'src', 'modules', 'risk', 'risk.service.ts');
const REGISTRY = path.join(__dirname, '..', 'src', 'modules', 'risk', 'risk-profile-rules.ts');
const SETTINGS = path.join(__dirname, '..', 'src', 'common', 'settings', 'settings-registry.ts');
const REL_REGISTRY = 'nest/src/modules/risk/risk-profile-rules.ts';

/** Scalar keys of `interface PortfolioRisk`. */
function readPortfolioRiskKeys(src) {
  const m = /export\s+interface\s+PortfolioRisk\s*\{([\s\S]*?)\n\}/.exec(src);
  if (!m) return { error: 'Could not find `interface PortfolioRisk` in risk.service.ts' };
  const keys = [];
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!line) continue;
    const k = /^([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/.exec(line);
    if (k) keys.push(k[1]);
  }
  return { keys };
}

/** `key: 'x'` / `defaultValue: N` / `enforcement: 'y'` / `settingKey: 'z' | null` per rule object. */
function readRegistry(src) {
  const entries = [];
  const objectRe = /\{[^{}]*field:\s*'([^']+)'[\s\S]*?\n\s*\}/g;
  let m;
  while ((m = objectRe.exec(src)) !== null) {
    const block = m[0];
    const pick = (re) => {
      const r = re.exec(block);
      return r ? r[1] : undefined;
    };
    const settingKeyRaw = /settingKey:\s*(null|'([^']*)')/.exec(block);
    entries.push({
      field: m[1],
      enforcement: pick(/enforcement:\s*'([^']+)'/),
      enforcedBy: (() => {
        const r = /enforcedBy:\s*(null|'([^']*)')/.exec(block);
        if (!r) return undefined;
        return r[1] === 'null' ? null : r[2];
      })(),
      settingKey: settingKeyRaw ? (settingKeyRaw[1] === 'null' ? null : settingKeyRaw[2]) : undefined,
      defaultValue: pick(/defaultValue:\s*(-?[\d.]+)/),
    });
  }
  return entries;
}

/** Map of `settings-registry.ts` key → declared default. */
function readSettingsDefaults(src) {
  const map = new Map();
  const keyRe = /key:\s*'([^']+)'/g;
  let m;
  while ((m = keyRe.exec(src)) !== null) {
    // The default belongs to this key if it appears before the next `key:`.
    const from = m.index;
    const nextKey = src.indexOf('key:', from + 4);
    const slice = src.slice(from, nextKey === -1 ? src.length : nextKey);
    const d = /defaultValue:\s*(-?[\d.]+)/.exec(slice);
    if (d) map.set(m[1], Number(d[1]));
  }
  return map;
}

function run() {
  const findings = [];

  for (const [label, p] of [['risk.service.ts', SERVICE], ['risk-profile-rules.ts', REGISTRY], ['settings-registry.ts', SETTINGS]]) {
    if (!fs.existsSync(p)) {
      console.error(`[risk-profile] ${label} not found at ${p}`);
      process.exit(1);
    }
  }

  const serviceSrc = fs.readFileSync(SERVICE, 'utf8');
  const registrySrc = fs.readFileSync(REGISTRY, 'utf8');
  const settingsSrc = fs.readFileSync(SETTINGS, 'utf8');

  const shape = readPortfolioRiskKeys(serviceSrc);
  if (shape.error) {
    console.error(`[risk-profile] ${shape.error}`);
    process.exit(1);
  }
  const entries = readRegistry(registrySrc);

  // ── refuse to pass on an empty parse ────────────────────────────────────────────────────────
  // A parser that reads nothing makes every check below vacuous and reports a clean bill of health —
  // the exact failure this gate exists to prevent.
  if (entries.length === 0) {
    console.error('[risk-profile] CANARY INVALID — parsed 0 rule declarations from risk-profile-rules.ts.');
    console.error('[risk-profile]   Refusing to report OK. Fix the parser or the registry format.');
    process.exit(1);
  }
  if (shape.keys.length === 0) {
    console.error('[risk-profile] CANARY INVALID — parsed 0 keys from interface PortfolioRisk.');
    console.error('[risk-profile]   Refusing to report OK. Fix the parser.');
    process.exit(1);
  }

  const declared = new Set(entries.map((e) => e.field));
  const settingsDefaults = readSettingsDefaults(settingsSrc);
  if (settingsDefaults.size === 0) {
    console.error('[risk-profile] CANARY INVALID — parsed 0 settings keys from settings-registry.ts.');
    process.exit(1);
  }

  // ── 1. every interface key declared ─────────────────────────────────────────────────────────
  for (const key of shape.keys) {
    if (declared.has(key)) continue;
    findings.push(
      `UNDECLARED CONSTANT  PortfolioRisk.${key} has no entry in risk-profile-rules.ts.\n` +
        `    Add one, naming its enforcement status and the setting that backs it:\n` +
        `      { field: '${key}', label: '...', enforcement: 'live|legacy-only|display-only|none',\n` +
        `        enforcedBy: '...' | null, settingKey: 'risk.${key}' | null, defaultValue: <n>, summary: '...' }`,
    );
  }

  // ── 2. every declaration still exists ───────────────────────────────────────────────────────
  const keys = new Set(shape.keys);
  for (const e of entries) {
    if (!keys.has(e.field)) {
      findings.push(
        `STALE RULE  risk-profile-rules.ts declares '${e.field}' but PortfolioRisk has no such key. ` +
          `Remove the declaration or restore the key.`,
      );
    }
  }

  // ── 3–6. per-rule checks ────────────────────────────────────────────────────────────────────
  for (const e of entries) {
    if (e.enforcedBy === undefined) {
      findings.push(`MISSING enforcedBy  rule '${e.field}' has no \`enforcedBy\` key at all (use null).`);
    }
    if (e.settingKey === undefined) {
      findings.push(`MISSING settingKey  rule '${e.field}' has no \`settingKey\` key at all (use null).`);
    }

    // 3. enforcement claim must be backed by a real file that mentions the field
    if (e.enforcement === 'none') {
      if (e.enforcedBy !== null) {
        findings.push(
          `CONTRADICTION  rule '${e.field}' is enforcement:'none' but names a file ('${e.enforcedBy}'). ` +
            `One of the two is wrong.`,
        );
      }
    } else if (!e.enforcedBy) {
      if (e.enforcement === 'live' || e.enforcement === 'legacy-only') {
        findings.push(
          `NO ENFORCER  rule '${e.field}' claims enforcement:'${e.enforcement}', which asserts it can ` +
            `change a trade, but lists no file.`,
        );
      }
    } else {
      const abs = path.join(ROOT, e.enforcedBy);
      if (!fs.existsSync(abs)) {
        findings.push(`MISSING FILE  rule '${e.field}' points at ${e.enforcedBy}, which does not exist.`);
      } else if (!fs.readFileSync(abs, 'utf8').includes(e.field)) {
        findings.push(
          `NOT REFERENCED  rule '${e.field}' claims enforcement:'${e.enforcement}' in ${e.enforcedBy}, ` +
            `but that file never mentions '${e.field}'.`,
        );
      }
    }

    // 4. 🔑 a LIVE cap must be operator-movable
    if (e.enforcement === 'live' && e.settingKey === null) {
      findings.push(
        `UNMOVABLE LIVE CAP  '${e.field}' can refuse a live order and has no settingKey.\n` +
          `    A risk cap an operator cannot find is one that gets worked around rather than reviewed.\n` +
          `    Add a setting to settings-registry.ts and name it here. (This is the check that would\n` +
          `    have surfaced maxPerSymbol: 0.25 on the day it was written — it blocked 78 trades.)`,
      );
    }

    // 5 + 6. the setting must exist, and the two copies of the number must agree
    if (e.settingKey) {
      if (!settingsDefaults.has(e.settingKey)) {
        findings.push(
          `MISSING SETTING  rule '${e.field}' names settingKey '${e.settingKey}', which is not declared ` +
            `in settings-registry.ts.`,
        );
      } else if (
        e.defaultValue !== undefined &&
        Number(e.defaultValue) !== settingsDefaults.get(e.settingKey)
      ) {
        findings.push(
          `DEFAULT DRIFT  '${e.field}' declares defaultValue ${e.defaultValue} but setting ` +
            `'${e.settingKey}' declares ${settingsDefaults.get(e.settingKey)}. Two copies of one number ` +
            `is how 25% ended up in five files — make them agree.`,
        );
      }
    }
  }

  // ── 7. one copy of each number ──────────────────────────────────────────────────────────────
  //
  // ⚠️ NARROW BY DESIGN. The first version of this check matched `field: <number>` anywhere in the
  // tree and produced 19 findings of which 3 were FALSE: `AveragingPolicy.maxPositions`,
  // `PositionCheckConfig.maxPositions` and a performance-metrics `maxDrawdown`. Those are different
  // concepts that happen to share a field name — `maxPositions` in an averaging policy means "how
  // many times may we add to ONE position", which has nothing to do with a portfolio ceiling.
  //
  // A guard with false positives gets allowlisted, and an allowlisted guard is worse than none. So
  // the rule is: an object is "risk-profile-shaped" when **three or more** declared fields appear
  // near each other. Each of the three false positives contains exactly one. That is the whole
  // discriminator, and it is checkable.
  //
  // ⚠️ MATCH ON BARE NAMES, NOT `name:`. The first version required a colon, which missed the most
  // likely regression of all — a re-hardcoded cap inside a builder call whose OTHER properties are
  // shorthand:
  //
  //     buildRiskProfile({ maxOpenPositions, maxPerSymbol: 0.25, maxDrawdown })
  //                                        ^^^^^^^^^^^^^^^^^^^ only ONE `name:` in the window
  //
  // That hole was found by a canary, not by review. Bare names fix it: `maxOpenPositions` and
  // `maxDrawdown` count whether or not they carry a colon.
  const numericFields = entries.map((e) => e.field);
  const WINDOW = 400;
  const walk = (dir, out = []) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (item.name === 'node_modules' || item.name === 'dist') continue;
        walk(abs, out);
      } else if (item.name.endsWith('.ts') && !item.name.endsWith('.spec.ts')) {
        out.push(abs);
      }
    }
    return out;
  };
  const anyFieldRe = new RegExp(`\\b(${numericFields.join('|')})\\b`, 'g');
  for (const abs of walk(path.join(__dirname, '..', 'src'))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (rel === REL_REGISTRY) continue; // the ONE allowed home
    const src = fs.readFileSync(abs, 'utf8');

    const sites = [];
    let fm;
    anyFieldRe.lastIndex = 0;
    while ((fm = anyFieldRe.exec(src)) !== null) sites.push({ name: fm[1], index: fm.index });

    // Collect the distinct profile-shaped regions first, so one object yields at most one report
    // per field rather than one per member.
    //
    // TWO ways a region is recognised, and both are needed:
    //
    //   (a) DENSITY — three or more declared field names near each other. Catches a hand-written
    //       `PortfolioRisk` literal, which is what the original defect was.
    //   (b) CALL SITE — an actual `buildRiskProfile(` invocation.
    //
    // ⚠️ (b) exists because density ALONE misses the likeliest regression, and a canary proved it.
    // The builder's parameters are named for the SETTING (`maxOpenPositions`), not the interface
    // key (`maxPositions`), so this line
    //
    //     buildRiskProfile({ maxOpenPositions, maxPerSymbol: 0.25, maxDrawdown })
    //
    // contains only TWO declared names — under any sensible density threshold. Density can never
    // see it, however wide the window. (b) is not a fudge to make a test pass; it names the
    // boundary this file cares about, and there is exactly one such function.
    const regions = [];
    const CALL_ANCHOR = 'buildRiskProfile(';
    for (let at = src.indexOf(CALL_ANCHOR); at !== -1; at = src.indexOf(CALL_ANCHOR, at + 1)) {
      regions.push({ lo: at, hi: at + 400 });
    }
    for (const site of sites) {
      const near = sites.filter((s) => Math.abs(s.index - site.index) <= WINDOW);
      if (new Set(near.map((s) => s.name)).size < 3) continue;
      const lo = Math.min(...near.map((s) => s.index));
      const hi = Math.max(...near.map((s) => s.index)) + 80;
      if (!regions.some((r) => lo >= r.lo && hi <= r.hi)) regions.push({ lo, hi });
    }

    const reported = new Set();
    for (const r of regions) {
      const slice = src.slice(r.lo, r.hi);
      for (const field of numericFields) {
        if (reported.has(field)) continue;
        if (!new RegExp(`\\b${field}\\s*:\\s*-?[\\d.]+\\b`).test(slice)) continue;
        reported.add(field);
        findings.push(
          `DUPLICATE LITERAL  ${rel} hardcodes \`${field}: <number>\` inside a risk-profile-shaped ` +
            `object.\n` +
            `    Use buildRiskProfile() so one change cannot leave the other copies behind — this is ` +
            `how 0.25 ended up in five files.`,
        );
      }
    }
  }

  const counted = {};
  for (const e of entries) counted[e.enforcement ?? 'unset'] = (counted[e.enforcement ?? 'unset'] ?? 0) + 1;
  const summary =
    `keys=${shape.keys.length} declared=${declared.size} ` +
    Object.entries(counted).map(([k, v]) => `${k}=${v}`).join(' ');

  if (findings.length) {
    console.error(`\n[risk-profile] ✖ ${findings.length} finding(s) — ${summary}\n`);
    for (const f of findings) console.error(`  ${f}\n`);
    console.error('[risk-profile] A cap nobody declared is a cap nobody can review.');
    process.exit(1);
  }

  console.log(`[risk-profile] ✅ OK — ${summary}`);
  console.log(
    '[risk-profile]   note: static check. It proves every cap is declared and operator-movable, NOT that the value is right.',
  );
}

run();
