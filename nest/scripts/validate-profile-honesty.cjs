/**
 * validate-profile-honesty.cjs — an adapter must not claim a company profile it does not have (#966).
 *
 * WHY THIS EXISTS
 * ---------------
 * `InteractiveBrokersAdapter.getProfile()` returned, for EVERY symbol:
 *
 *     { name: `${symbol} Inc. (IBKR Mock)`, exchange: 'NYSE',
 *       sector: 'Technology', industry: 'Software', marketCap: 50_000_000_000 }
 *
 * ⚠️ A mock QUOTE is obviously mock — random numbers change every call. A mock PROFILE is not:
 * "Technology / Software / $50B" is a plausible-looking FACT, indistinguishable from a real one,
 * and it flowed into the Symbols Browser. Had `IBKR_MODE=mock` been set on a machine whose profile
 * chain reached that adapter, every symbol would have confidently claimed to be a $50B NYSE
 * software company. Same class as #959 (`'Xtrend'`) and the constants removed in #638.
 *
 * THE TWO RULES — narrow, and each one was a real defect
 * -----------------------------------------------------
 *   1. **No fabricated literal.** Inside a `getProfile()` body, `sector:` / `industry:` /
 *      `marketCap:` must not be a string or numeric LITERAL. Reading it from a response
 *      (`data.finnhubIndustry`), falling back to `null`, or passing a parameter through is fine —
 *      a constant is not, because it is the same answer for every symbol in the app.
 *   2. **No undelivered capability.** An adapter registered with `'profiles'` in its capability
 *      list whose `getProfile()` body is *only* `return null` declares a capability it never
 *      delivers. `AdapterFactory.resolveProfile()` picks candidates from that list, so the claim
 *      makes the chain try a provider that cannot answer.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT DO. It does not try to decide whether a value is *true* —
 * only whether it was **looked up** or **typed**. A guard that attempted to judge truth would fire
 * on legitimate venue constants and would then be allowlisted; narrow beats broad.
 *
 * Usage:  node scripts/validate-profile-honesty.cjs              # check + exit code
 *         node scripts/validate-profile-honesty.cjs --report     # list every getProfile found
 *         node scripts/validate-profile-honesty.cjs --self-test  # prove BOTH rules can FAIL
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { runCases } = require('../../scripts/lib/self-test.cjs');

// ⚠️ This file lives in `nest/scripts/`, so the repo root is TWO levels up. Getting this wrong
// produced `nest\nest\src\...` and an ENOENT that the self-test could not catch — it drives
// synthetic sources and never touches the filesystem. Fixed 2026-10-01 by running it live.
const ROOT = path.resolve(__dirname, '..', '..');
const ADAPTERS_DIR = path.join(ROOT, 'nest', 'src', 'modules', 'providers', 'adapters');
const MODULE_FILE = path.join(ROOT, 'nest', 'src', 'modules', 'providers', 'providers.module.ts');
const ALLOWANCE_FILE = path.join(__dirname, 'profile-honesty-allowance.json');

/** Fields that make up a company profile. */
const PROFILE_FIELDS = ['sector', 'industry', 'marketCap'];

/**
 * Strip line and block comments AND string literals' contents? No — comments only. String
 * literals must survive, because rule 1 exists to FIND them.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Extract the body of a method named `async getProfile(` by brace matching.
 * A naive regex cannot do this — the body contains object literals.
 * @returns {string|null} the text between the outer braces, or null when absent.
 */
function methodBody(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1) return null;
  let i = source.indexOf('{', start);
  if (i === -1) return null;
  let depth = 0;
  for (let j = i; j < source.length; j++) {
    const c = source[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(i + 1, j);
    }
  }
  return null;
}

/**
 * RULE 1 — profile fields assigned a literal.
 * @returns {Array<{ field: string, value: string }>}
 */
function findFabricatedFields(body) {
  if (body === null) return [];
  const clean = stripComments(body);
  const out = [];
  for (const field of PROFILE_FIELDS) {
    // `sector: 'Technology'` or `marketCap: 50_000_000_000`
    const re = new RegExp(`\\b${field}\\s*:\\s*('([^'\\\\]|\\\\.)*'|"([^"\\\\]|\\\\.)*"|-?\\d[\\d_]*(?:\\.\\d+)?e?\\d*)`, 'g');
    let m;
    while ((m = re.exec(clean)) !== null) {
      const raw = m[1];
      // `null` is not matched by this pattern at all — it is the honest value.
      out.push({ field, value: raw });
    }
  }
  return out;
}

/**
 * RULE 2 — a `getProfile()` body that can only ever return null.
 * True when every `return` in the body returns null/undefined and there is at least one.
 */
function alwaysReturnsNull(body) {
  if (body === null) return false;
  const clean = stripComments(body).replace(/\s+/g, ' ');
  const returns = clean.match(/\breturn\b[^;]*;/g) || [];
  if (returns.length === 0) return false;
  return returns.every((r) => /^return\s+(null|undefined)\s*;$/.test(r.trim()));
}

/**
 * RULE 3 support — which adapters DECLARE the `profiles` capability in providers.module.ts.
 * @returns {Record<string, string[]>} adapter id → capability list
 */
function declaredCapabilities(moduleSource) {
  const out = {};
  const re = /register\(\s*'([^']+)'[\s\S]*?capabilities:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(moduleSource)) !== null) {
    out[m[1]] = m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  }
  return out;
}

/**
 * The whole check over supplied SOURCES (pure — the self-test drives this same code).
 * @param {Record<string,string>} adapterSources  filename → source
 * @param {string} moduleSource
 * @param {object} allowance
 * @returns {{ failures: string[], infos: string[], stats: object }}
 */
function check(adapterSources, moduleSource, allowance) {
  const failures = [];
  const infos = [];
  const allow = allowance || {};
  const allowFields = allow.fabricatedFields || {};
  const allowCaps = allow.unfulfilledCapabilities || {};

  const caps = declaredCapabilities(moduleSource);
  let profiledAdapters = 0;
  /** Allowance keys that were actually needed this run — used for the anti-rot check below. */
  const usedFieldKeys = new Set();
  const usedCapIds = new Set();

  for (const [file, source] of Object.entries(adapterSources)) {
    const body = methodBody(source, 'async getProfile(');
    if (body === null) continue;
    profiledAdapters++;

    for (const hit of findFabricatedFields(body)) {
      const key = `${file}:${hit.field}`;
      if (key in allowFields) {
        usedFieldKeys.add(key);
        continue;
      }
      failures.push(
        `${file} — getProfile() sets \`${hit.field}: ${hit.value}\`, a LITERAL. Every symbol would ` +
        `get that same answer, and it is indistinguishable from a real one (#966). Read it from the ` +
        `provider's response, or return null. To keep a deliberate venue constant, declare ` +
        `"${key}" in scripts/profile-honesty-allowance.json with a reason.`,
      );
    }

    const id = file.replace(/\.adapter\.ts$/, '');
    const declaresProfiles = (caps[id] || []).includes('profiles');
    if (declaresProfiles && alwaysReturnsNull(body)) {
      if (id in allowCaps) usedCapIds.add(id);
      else failures.push(
        `${file} — providers.module.ts declares the 'profiles' capability, but getProfile() can ` +
        `only ever return null. AdapterFactory.resolveProfile() picks candidates from that list, so ` +
        `the claim makes the chain ask a provider that cannot answer. Remove 'profiles' from the ` +
        `registration, or declare "${id}" in scripts/profile-honesty-allowance.json.`,
      );
    }
  }

  // ── Anti-rot. An allowance that is no longer needed silently widens the exemption, so a stale
  // entry fails the build rather than sitting there covering rules that no longer exist. ──
  for (const key of Object.keys(allowFields)) {
    if (!usedFieldKeys.has(key)) {
      failures.push(
        `stale allowance: "fabricatedFields" still lists "${key}", but no getProfile() sets that ` +
        `field to a literal any more. Delete the entry — a stale exemption silently widens the allowance.`,
      );
    }
  }
  for (const key of Object.keys(allowCaps)) {
    if (!usedCapIds.has(key)) {
      failures.push(
        `stale allowance: "unfulfilledCapabilities" still lists "${key}", but that adapter no longer ` +
        `declares 'profiles' (or no longer returns null). Delete the entry.`,
      );
    }
  }

  // A check that read nothing must not pass.
  if (profiledAdapters === 0) {
    failures.push(
      'no adapter yielded a getProfile() body — the scanner matched nothing and must not report OK.',
    );
  }
  if (Object.keys(caps).length === 0) {
    failures.push(
      'providers.module.ts yielded no adapter registrations — the capability scanner matched nothing.',
    );
  }

  return { failures, infos, stats: { profiledAdapters, registrations: Object.keys(caps).length } };
}

// ─────────────────────────────────────────────────────────────────────────────

function readSources() {
  const adapterSources = {};
  for (const f of fs.readdirSync(ADAPTERS_DIR)) {
    if (!f.endsWith('.adapter.ts')) continue;
    adapterSources[f] = fs.readFileSync(path.join(ADAPTERS_DIR, f), 'utf8');
  }
  return { adapterSources, moduleSource: fs.readFileSync(MODULE_FILE, 'utf8') };
}

function run() {
  const report = process.argv.includes('--report');
  const { adapterSources, moduleSource } = readSources();
  const allowance = fs.existsSync(ALLOWANCE_FILE)
    ? JSON.parse(fs.readFileSync(ALLOWANCE_FILE, 'utf8'))
    : {};
  const { failures, stats } = check(adapterSources, moduleSource, allowance);

  console.log(
    `[profile-honesty] ${stats.profiledAdapters} getProfile() implementation(s) · ` +
    `${stats.registrations} adapter registration(s)`,
  );
  if (report) {
    for (const f of Object.keys(adapterSources)) {
      if (methodBody(adapterSources[f], 'async getProfile(') !== null) console.log(`   · ${f}`);
    }
  }
  for (const f of failures) console.error(`   ✗ ${f}`);
  if (failures.length) {
    console.error(`[profile-honesty] ✗ ${failures.length} problem(s) — an adapter claims a profile it does not have (#966).`);
    return 1;
  }
  console.log('[profile-honesty] ✅ OK — every advertised profile is looked up, never typed.');
  return 0;
}

function selfTest() {
  const MODULE_OK = `
    this.adapterFactory.register('alpha', AlphaAdapter, {
      capabilities: ['quotes', 'profiles'],
      failoverPriority: 50,
    });
    this.adapterFactory.register('beta', BetaAdapter, {
      capabilities: ['quotes', 'candles'],
      failoverPriority: 60,
    });
  `;
  const REAL = `
    async getProfile(symbol: string) {
      const data = await this.get(symbol);
      return { sector: data.sector || null, industry: d.industry, marketCap: p.mktCap ?? null };
    }
  `;
  const NULL_ONLY = `async getProfile(_symbol: string) { return null; }`;
  const FABRICATED = `
    async getProfile(symbol: string) {
      return { sector: 'Technology', industry: 'Software', marketCap: 50_000_000_000 };
    }
  `;
  const FABRICATED_ONE = `
    async getProfile(symbol: string) {
      if (!this.enabled) return null;
      return { sector: null, industry: null, marketCap: 1 };
    }
  `;
  const CONDITIONAL_NULL = `
    async getProfile(symbol: string) {
      if (!this.hasCredentials) return null;
      return { sector: data.Sector || null, industry: null, marketCap: null };
    }
  `;
  const NONE = {};

  const cases = [];
  const t = (name, fn) => cases.push({ name, fn });

  t('baseline: a looked-up profile PASSES', () => {
    const r = check({ 'alpha.adapter.ts': REAL, 'beta.adapter.ts': NULL_ONLY }, MODULE_OK, NONE);
    return r.failures.length === 0;
  });

  t('CANARY a literal sector/industry/marketCap → FAIL', () => {
    const r = check({ 'alpha.adapter.ts': FABRICATED }, MODULE_OK, NONE);
    return r.failures.filter((f) => /LITERAL/.test(f)).length === 3;
  });

  t('CANARY even ONE literal field → FAIL', () => {
    const r = check({ 'alpha.adapter.ts': FABRICATED_ONE }, MODULE_OK, NONE);
    return r.failures.some((f) => /marketCap: 1/.test(f));
  });

  t('CANARY an undelivered capability → FAIL', () => {
    const r = check({ 'alpha.adapter.ts': NULL_ONLY }, MODULE_OK, NONE);
    return r.failures.some((f) => /only ever return null/.test(f));
  });

  t('a conditional null return is NOT an undelivered capability', () => {
    const r = check({ 'alpha.adapter.ts': CONDITIONAL_NULL }, MODULE_OK, NONE);
    return r.failures.length === 0;
  });

  t('an adapter that does NOT declare profiles may return null', () => {
    const r = check({ 'beta.adapter.ts': NULL_ONLY }, MODULE_OK, NONE);
    return r.failures.length === 0;
  });

  t('a declared allowance silences a deliberate constant', () => {
    const r = check({ 'alpha.adapter.ts': FABRICATED }, MODULE_OK, {
      fabricatedFields: { 'alpha.adapter.ts:sector': 'venue constant', 'alpha.adapter.ts:industry': 'venue constant', 'alpha.adapter.ts:marketCap': 'venue constant' },
    });
    return r.failures.length === 0;
  });

  t('CANARY a declared allowance does NOT silence a different file', () => {
    const r = check({ 'alpha.adapter.ts': FABRICATED, 'beta.adapter.ts': FABRICATED }, MODULE_OK, {
      fabricatedFields: { 'alpha.adapter.ts:sector': 'x', 'alpha.adapter.ts:industry': 'x', 'alpha.adapter.ts:marketCap': 'x' },
    });
    return r.failures.some((f) => /beta\.adapter\.ts/.test(f));
  });

  t('CANARY no getProfile found at all → ERROR, never PASS', () => {
    const r = check({ 'alpha.adapter.ts': 'export class X {}' }, MODULE_OK, NONE);
    return r.failures.some((f) => /matched nothing/.test(f));
  });

  t('CANARY no registrations found → ERROR, never PASS', () => {
    const r = check({ 'alpha.adapter.ts': REAL }, 'const x = 1;', NONE);
    return r.failures.some((f) => /no adapter registrations/.test(f));
  });

  t('a comment mentioning a literal does not fire the guard', () => {
    const commented = `
      async getProfile(symbol: string) {
        // sector: 'Technology' used to be hardcoded here (#966) — do not reinstate.
        return { sector: d.sector || null, industry: null, marketCap: null };
      }
    `;
    const r = check({ 'alpha.adapter.ts': commented }, MODULE_OK, NONE);
    return r.failures.length === 0;
  });

  t('the brace matcher survives nested object literals', () => {
    const nested = `
      async getProfile(symbol: string) {
        const p = { a: { b: 1 }, c: [1, 2] };
        return { sector: p.a ? null : null, industry: null, marketCap: null };
      }
    `;
    const r = check({ 'alpha.adapter.ts': nested }, MODULE_OK, NONE);
    return r.failures.length === 0;
  });

  t('CANARY a stale allowance entry → FAIL (anti-rot)', () => {
    const r = check({ 'alpha.adapter.ts': REAL }, MODULE_OK, {
      fabricatedFields: { 'alpha.adapter.ts:sector': 'no longer needed' },
    });
    return r.failures.some((f) => /stale allowance/.test(f));
  });

  t('CANARY a stale capability allowance → FAIL (anti-rot)', () => {
    const r = check({ 'beta.adapter.ts': REAL }, MODULE_OK, {
      unfulfilledCapabilities: { beta: 'no longer needed' },
    });
    return r.failures.some((f) => /stale allowance/.test(f));
  });

  // The harness is shared with every other validator — see scripts/lib/self-test.cjs, extracted
  // after validate-duplication.cjs flagged the copy as a NEW 6-block pair.
  return runCases(cases, 'profile-honesty');
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  else process.exit(run());
}

module.exports = { stripComments, methodBody, findFabricatedFields, alwaysReturnsNull, declaredCapabilities, check };
