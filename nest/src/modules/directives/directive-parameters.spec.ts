/**
 * Directive Parameters — CONFORMANCE. The guard that makes a `params` declaration trustworthy.
 * ==============================================================================================
 * #761 is why this file exists. A `directionBias` DECLARATION was once used to decide protocol
 * capacity, and it was reverted after measurement showed declarations understate reality —
 * `macd-crossover` declared `neutral` and emitted a direction 5,252 times. Those directives were never
 * wrong; the *declaration* was. So a declaration is not evidence, and `params` is a declaration.
 *
 * For EVERY directive that declares `params`, this spec proves two things:
 *
 *   1. NEUTRALITY — supplying nothing produces exactly the same result as supplying the declared
 *      defaults, and both match the shipped behaviour. This is the guarantee that parameterisation
 *      cannot change live scoring by accident.
 *   2. LIVENESS — moving each parameter actually MOVES the output on a fixture. A declared knob that
 *      cannot move the output is either dead (delete it) or under-tested (widen the fixture). It is
 *      never allowed to pass, because a user will tune an inert control and believe the result.
 *
 * ⚠️ THE DIRECTIVE LIST IS DERIVED FROM `directives.module.ts`, not typed out here. A hand-written list
 * is a declaration too, and it would silently omit the next directive that gains parameters — which is
 * exactly the directive-parameters equivalent of #761.
 *
 * A directive that declares `params` but cannot be constructed or evaluated is reported as
 * INDETERMINATE and FAILS. "Cannot judge" must never render the same as "fine".
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { specProblems, defaultParams, type ParamSpec } from './parameters';
import { FIXTURES, fixtureBars, dailyBarsFrom, newsFeed } from './directive-fixtures';
import { MarketSessionsService } from '../calendar/market-sessions.service';

/**
 * Dependency-free services the harness may supply, so a directive with a constructor parameter is
 * still testable.
 *
 * ⚠️ WHY THIS LIST EXISTS (#1165, measured 2026-11-01). The directive list is DERIVED from
 * `directives.module.ts`, which is right — but a directive whose constructor takes a service threw on
 * `new Cls()`, and the suite reported that as INDETERMINATE → FAIL for a perfectly well-formed
 * directive (`session-open-effect`). "Cannot judge" must not be reported as fine, and it must not be
 * reported as broken either — the harness has to be able to construct what it judges.
 *
 * The rule for entry: the service must be a PURE, dependency-free class whose real behaviour is the
 * behaviour under test. `MarketSessionsService` qualifies — it is calendar arithmetic with no I/O, so
 * supplying the REAL one gives the directive real sessions. Anything needing a database, a network or
 * a clock is NOT listed here; it gets the permissive proxy instead, so the directive takes its own
 * documented no-dependency path rather than a fabricated one. See `permissiveStub` for the single
 * seeded model and why it had to be seeded.
 */
const TEST_SAFE_SERVICES: readonly any[] = [new MarketSessionsService()];

/**
 * A permissive stub: every property is a function returning undefined.
 *
 * ⚠️ ONE DELIBERATE EXCEPTION — `socialMention.findFirst` returns a SEEDED ROW (2026-11-01).
 * Without it, `social-buzz` could not expose its `HIGH_BUZZ_THRESHOLD` at all: the call threw, the
 * directive took its catch branch, and the threshold was unreachable on every fixture, so LIVENESS
 * would have failed for ever. A stub that answers "no rows" and a stub that answers "here is a row"
 * test different halves of the directive; this seeds the row so the SCORING half is exercised, and
 * the row's `totalMentions` (60) is chosen to sit ABOVE the 50 default so raising the threshold
 * demonstrably lowers the volume term. No other model is seeded — they still return `undefined`,
 * which is the directive's own "no data" path, not a fabricated answer.
 */
const SOCIAL_SEED = { totalMentions: 60, avgSentiment: 0.4, redditMentions: 12, twitterMentions: 8 };

function permissiveStub(): any {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') return undefined;
        if (prop === 'socialMention') return { findFirst: async () => ({ ...SOCIAL_SEED }) };
        return () => undefined;
      },
    },
  );
}

const MODULE_PATH = path.join(__dirname, 'directives.module.ts');

/** Every directive class the application registers, resolved from the module's own imports. */
function loadRegisteredDirectives(): Array<{ file: string; Cls: new () => any }> {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const re = /from '\.\/implementations\/([^']+)'/g;
  const files = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) files.add(m[1]);

  const out: Array<{ file: string; Cls: new () => any }> = [];
  for (const rel of files) {
    // Skip spec files if any are ever imported by mistake.
    if (rel.endsWith('.spec')) continue;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(`./implementations/${rel}`);
    for (const [name, val] of Object.entries(mod)) {
      if (typeof val !== 'function') continue;
      // Only classes that look like directives: they carry an `id` on the prototype or declare params.
      const proto = (val as any).prototype;
      if (!proto) continue;
      if (typeof proto.calculate !== 'function') continue;
      out.push({ file: rel, Cls: val as new () => any });
    }
  }
  return out;
}

// The bar library lives in its own module (#1165): it is the shared basis for every parameter's
// liveness proof, and a fixture set that only exists inside a spec cannot be reasoned about by the
// next directive that needs a new shape. `FIXTURES` names the set under test; the file explains which
// knob each shape makes provable.

/**
 * The BASELINE is the recorded production behaviour of every parameterised directive.
 *
 * ⚠️ Why this exists, and why `NEUTRALITY` alone is not enough. Comparing "no params" against "the
 * declared defaults" is nearly a tautology — both come from the same spec. It cannot catch a WRONG
 * default: setting `default: 21` where production used 14 passes that comparison while changing live
 * scoring for every protocol. The baseline is the anchor that makes the default mean something.
 *
 * It was recorded after verifying the parameterised directives produce byte-identical output to the
 * shipped code at HEAD (2026-11-01, `git show HEAD:…` vs the new class, four fixtures, both directives).
 *
 * To update DELIBERATELY — because a default is being changed on purpose — run:
 *   UPDATE_PARAM_BASELINE=1 npx jest directive-parameters
 * and put the baseline change in the same commit as the reason for it.
 */
const BASELINE_PATH = path.join(__dirname, 'directive-parameters.baseline.json');

function loadBaseline(): Record<string, Record<string, string>> {
  if (fs.existsSync(BASELINE_PATH)) {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  }
  return {};
}

function saveBaseline(data: Record<string, Record<string, string>>): void {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

/** Shape the baseline stores: sha256 of each fixture's result JSON, so a diff points at the fixture. */
async function fingerprint(directive: any): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const kind of FIXTURES) {
    const res = await directive.calculate({
      symbol: 'FIXTURE',
      bars: fixtureBars(kind),
      dayBars: dailyBarsFrom(fixtureBars(kind)),
      hourBars: fixtureBars(kind),
      news: newsFeed(AS_OF),
      timeframe: '1h',
      asOf: AS_OF,
    });
    out[kind] = createHash('sha256').update(JSON.stringify(res)).digest('hex').slice(0, 16);
  }
  return out;
}

/** A fixed evaluation clock, so a directive that reads `asOf` cannot vary between two calls. */
const AS_OF = new Date(Date.UTC(2026, 0, 10));

async function evaluate(directive: any, params: Record<string, unknown> | undefined): Promise<string> {
  const results: string[] = [];
  for (const kind of FIXTURES) {
    const res = await directive.calculate({
      symbol: 'FIXTURE',
      bars: fixtureBars(kind),
      dayBars: dailyBarsFrom(fixtureBars(kind)),
      hourBars: fixtureBars(kind),
      news: newsFeed(AS_OF),
      timeframe: '1h',
      asOf: AS_OF,
      ...(params ? { params } : {}),
    });
    results.push(JSON.stringify(res));
  }
  return results.join('\n');
}

/**
 * The declared TYPE NAMES of a directive's constructor parameters, in order.
 *
 * Read from source because TypeScript erases decorator metadata here — `Cls.length` tells you how
 * MANY dependencies there are but never what they are, and supplying them by position is how
 * `social-buzz` ended up holding a `MarketSessionsService` where it expected a `PrismaService`.
 * Returns `[]` when there is no constructor, which is the common case.
 */
function constructorParamTypes(file: string): string[] {
  const base = path.join(__dirname, 'implementations', file);
  const full = fs.existsSync(base) ? base : `${base}.ts`;
  const src = fs.readFileSync(full, 'utf8');
  const sig = /constructor\s*\(([\s\S]*?)\)\s*\{/.exec(src);
  if (!sig) return [];
  return [...sig[1].matchAll(/:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
}

const registered = loadRegisteredDirectives();
const withParams = registered
  .map(({ file, Cls }) => {
    let instance: any;
    let constructError: string | null = null;
    // ⚠️ SUPPLY DEPENDENCIES UP FRONT (#1165, measured 2026-11-01). `new Cls()` does NOT throw for a
    // directive with a constructor dependency — NestJS injects outside the class, so the field is
    // simply `undefined` and the failure is DEFERRED into `calculate()` with "Cannot read properties of
    // undefined". A try/catch around the constructor therefore proved nothing, and
    // `session-open-effect` failed every test with a stack trace that pointed at its own body.
    //
    // So real services are passed positionally, and anything else gets a permissive stub — the same
    // `undefined` behaviour the directive already had, but callable, so its own guard clauses run.
    //
    // ⚠️ BY DECLARED TYPE, NOT BY INDEX (2026-11-01, measured). The first version was
    // `TEST_SAFE_SERVICES[i]`, which gave `MarketSessionsService` to ANY directive whose first
    // constructor parameter was something else — so `social-buzz` received a calendar service as its
    // `PrismaService`, the query threw, and its threshold parameter was unreachable. The list is
    // matched against the parameter's declared type name now; an index cannot tell you what it is.
    const args = constructorParamTypes(file).map(
      (type) => TEST_SAFE_SERVICES.find((s) => s.constructor.name === type) ?? permissiveStub(),
    );
    for (let i = args.length; i < Cls.length; i++) args.push(permissiveStub());
    try {
      instance = new Cls(...args);
    } catch (err) {
      try {
        instance = new Cls();
      } catch (err2) {
        return { file, instance: null, constructError: `${String((err as Error)?.message ?? err)} / ${String((err2 as Error)?.message ?? err2)}` };
      }
      constructError = null;
    }
    return { file, instance, constructError };
  })
  .filter((d) => d.instance && Array.isArray(d.instance.params) && d.instance.params.length > 0);

describe('directive parameters — the derived list is not empty', () => {
  it('found the directives that declare params (a scan that finds nothing must FAIL, not pass)', () => {
    expect(registered.length).toBeGreaterThan(100);
    expect(withParams.length).toBeGreaterThan(0);
  });
});

describe.each(withParams.map((d) => [d.instance.id as string, d] as const))(
  'directive "%s"',
  (_id, entry) => {
    const directive = entry.instance;
    const specs = directive.params as readonly ParamSpec[];

    it('declares a well-formed spec', () => {
      expect(specProblems(specs)).toEqual([]);
    });

    it('NEUTRALITY: no params === declared defaults (parameterisation cannot move live scoring)', async () => {
      const plain = await evaluate(directive, undefined);
      const explicit = await evaluate(directive, defaultParams(specs));
      expect(explicit).toBe(plain);
    });

    it('NEUTRALITY: an empty params object is the same as no params', async () => {
      const plain = await evaluate(directive, undefined);
      expect(await evaluate(directive, {})).toBe(plain);
    });

    // ⚠️ THE ANCHOR. The two tests above cannot catch a WRONG default, because both sides read the
    // same spec. This one compares against recorded production behaviour, so moving a default fails
    // the build instead of silently changing every protocol that uses the directive.
    it('BASELINE: the declared defaults still reproduce recorded production behaviour', async () => {
      const baseline = loadBaseline();
      const actual = await fingerprint(directive);
      const update = process.env.UPDATE_PARAM_BASELINE === '1';

      if (update) {
        baseline[directive.id] = actual;
        saveBaseline(baseline);
      }

      const recorded = baseline[directive.id];
      // A directive that declares params but has no baseline must FAIL, not pass on a default.
      expect({
        id: directive.id,
        recorded: recorded ?? null,
        hint: recorded ? '' : 'run UPDATE_PARAM_BASELINE=1 npx jest directive-parameters and commit the baseline file',
      }).toEqual({ id: directive.id, recorded: actual, hint: '' });
    });

    // ⚠️ SCORE BOUNDS — the guard that catches a whole CLASS of defect that parameterisation enables.
    // The directive contract says score is in [0, maxScore]. An expression written against a FIXED
    // constant is often unclamped and safe only by arithmetic accident: `25 - (2 - dist) * 10` floors at
    // 5, but widen that 2 to 10 and it reaches -55. Nothing checked this, and the first real example
    // (`support-resistance-levels`, measured on SPY 1h 2026-11-01) returned **-14** before it was caught
    // by inspection. Every parameterised directive is now swept across every parameter at its min and max.
    it('SCORE BOUNDS: every parameter extreme keeps the score inside 0..maxScore', async () => {
      const violations: string[] = [];
      const extremes: Array<Record<string, number | boolean>> = [{}];
      for (const spec of specs) {
        if (spec.type === 'number') {
          extremes.push({ [spec.key]: (spec as any).min }, { [spec.key]: (spec as any).max });
        } else {
          extremes.push({ [spec.key]: true }, { [spec.key]: false });
        }
      }
      for (const params of extremes) {
        for (const kind of FIXTURES) {
          const res: any = await directive.calculate({
            symbol: 'FIXTURE',
            bars: fixtureBars(kind),
      dayBars: dailyBarsFrom(fixtureBars(kind)),
      hourBars: fixtureBars(kind),
      news: newsFeed(AS_OF),
            timeframe: '1h',
            asOf: AS_OF,
            ...(Object.keys(params).length ? { params } : {}),
          });
          if (typeof res?.score === 'number' && (res.score < 0 || res.score > directive.maxScore)) {
            violations.push(`${JSON.stringify(params)} on ${kind} → ${res.score} (allowed 0..${directive.maxScore})`);
          }
        }
      }
      expect(violations).toEqual([]);
    });

    for (const spec of specs) {
      if (spec.type !== 'number') continue;
      it(`LIVENESS: "${spec.key}" actually moves the output at its min or max`, async () => {
        const base = await evaluate(directive, undefined);
        const atMin = await evaluate(directive, { [spec.key]: (spec as any).min });
        const atMax = await evaluate(directive, { [spec.key]: (spec as any).max });
        const moved = atMin !== base || atMax !== base;
        // A knob that cannot move the output is a lie in a UI. Fail with the fix, not just a boolean.
        expect({
          key: spec.key,
          moved,
          hint: moved
            ? ''
            : `"${spec.key}" is declared but no fixture changes when it moves. Either the directive does not read it, or the fixtures do not exercise the branch — widen FIXTURES or delete the param.`,
        }).toEqual({ key: spec.key, moved: true, hint: '' });
      });
    }
  },
);
