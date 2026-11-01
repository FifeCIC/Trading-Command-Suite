/**
 * Directive Parameters — the typed contract that lets a directive be configured per instance.
 * ==============================================================================================
 * M2 of the directive-depth programme (#1165). Register rows 107 and 109.
 *
 * ── DECISION (2026-11-01, primary) ──
 * WHAT:      A parameter is declared in `params` and PROVEN by two machine-checked conditions —
 *            BASELINE (no params reproduces recorded production output) and LIVENESS (moving it
 *            changes the output on a committed fixture). The directive list under test is DERIVED
 *            from `directives.module.ts`, never hand-written.
 * WHY:       #761. A `directionBias` declaration was used to decide protocol capacity and was
 *            reverted after measurement showed declarations understate reality — `macd-crossover`
 *            declared neutral and emitted a direction 5,252 times. Measured here too: a
 *            declaration-only contract passed while a default was deliberately moved 14 → 21.
 * INSTEAD OF: Declaring `paramSpec` and trusting it, which is what a UI-driven feature invites.
 * REVERSE BY: Drop `params` from `IDirective`/`DirectiveInput` and revert the three parameterised
 *            directives to their literals. The baseline proves the outputs are already identical,
 *            so reversal is a pure code revert with no data migration and no scoring change.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 110
 * GUARD:     nest/src/modules/directives/directive-parameters.spec.ts (runs in prebuild via jest)
 *
 * ── PRODUCT POSITION ─────────────────────────────────────────────────────────────────────────────
 * BEFORE: every tuning constant was a `const` in the directive's own file. 110 named constants and
 * 29 inline literal periods across 161 directives (measured 2026-11-01, #1166), and **0** directives
 * read any per-instance configuration. Changing one required a code edit, a rebuild and a full
 * backtest.
 * AFTER:  a directive declares a `params` spec, and reads its values from the resolved set. The
 * declared default of every parameter IS the constant it replaces, so an instance that supplies
 * nothing behaves exactly as it does today.
 * NEXT:   M4 (#1167) renders these specs as controls; the aggregation rule for multiple instances of
 * one directive is #1165.
 *
 * ── THE DESIGN RULE THAT MATTERS: A SPEC IS A CLAIM, NOT A CAPABILITY ────────────────────────────
 * ⚠️ This is the lesson of **#761**, and it is why this module does not simply trust `params`. #761
 * added a `directionBias` declaration to decide capacity, and it was reverted after measurement
 * showed declarations **understate reality** — `macd-crossover` declared `neutral` and emitted a
 * direction 5,252 times. `gen-directive-capabilities.cjs` now DERIVES its set from the source for
 * exactly this reason.
 *
 * So a `params` entry here is only a claim that a knob exists. It is made trustworthy by
 * `directive-parameters.spec.ts`, which for every declared parameter proves BOTH directions:
 *   • supplying nothing reproduces the hardcoded constant, byte for byte; and
 *   • changing the parameter actually MOVES the output on a fixture.
 * A parameter that cannot move the output is either dead (remove it) or untested (widen the fixture).
 * It is never allowed to pass silently — an ignored knob in a UI is worse than no knob, because a user
 * will tune it and believe the result.
 *
 * ── WHY VALIDATION IS SPLIT IN TWO ──────────────────────────────────────────────────────────────
 * `validateSupplied()` THROWS, and it is for the WRITE boundary — an API call or a UI submit, where a
 * human is present and a typo must be loud. A misspelled key that is silently ignored is the exact
 * failure this repo keeps re-finding.
 * `resolveParams()` does NOT throw, and it is for the READ path — scoring runs on every bar for every
 * symbol, so a stale or out-of-range stored value must not kill scoring. It clamps, and it reports.
 * Neither path is silent.
 */

/**
 * How a parameter renders on a chart — the seam between scoring and the charting surface.
 *
 * ⚠️ REQUIRED, not optional. A missing role would leave a tunable knob with no rendering path — a
 * buried ability, which this repo treats as a defect (either surface it, or remove it). Owner
 * direction 2026-11-01: *"I will want to tune those that are indicators on a chart so that we're also
 * building our charting technology and those that aren't as suited to a chart will need some form of
 * dynamic output."*
 *
 * | role | draws as | example |
 * |---|---|---|
 * | `series` | the indicator's own line; changing it reshapes the line | RSI period, MFI period |
 * | `threshold` | a horizontal guide line on the panel | oversold level 30, trend level 25 |
 * | `band` | the edge of a channel; two params make a band | Bollinger multiplier, Keltner period |
 * | `window` | a lookback region / bracket on the time axis | pivot window, S/R lookback |
 * | `proximity` | a distance band around the price line | "within 2% of a level" |
 * | `none` | **not chartable** — belongs in a dynamic/temporal visual | internal damping, ratio caps |
 *
 * `none` is a first-class answer, not a failure: it is the flag that a directive needs the temporal
 * visual instead of a chart, so the two surfaces are chosen deliberately rather than defaulted.
 */
export type ChartRole = 'series' | 'threshold' | 'band' | 'window' | 'proximity' | 'none';

const CHART_ROLES: readonly ChartRole[] = ['series', 'threshold', 'band', 'window', 'proximity', 'none'];

/**
 * One tunable knob.
 *
 * ⚠️ `default` MUST equal the constant currently hardcoded in the directive. That invariant is
 * asserted by `directive-parameters.spec.ts` against a recorded baseline, not merely documented here —
 * otherwise a parameter landing could change live scoring without anyone choosing to change it.
 */
export interface NumericParamSpec {
  readonly key: string;
  readonly label: string;
  readonly type: 'number';
  /** MUST be the value currently hardcoded in the directive. */
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  /** Unit shown beside the control, e.g. 'bars', '%'. Absent for a dimensionless count. */
  readonly unit?: string;
  /** How this renders. See `ChartRole` — `none` means it needs the dynamic visual instead. */
  readonly chart: ChartRole;
  /** Why this knob is worth turning — the measurement, with a date. Not a restatement of the label. */
  readonly why: string;
  /** The exact constant this replaces, as `file:line` in the directive source. */
  readonly source: string;
}

export interface BooleanParamSpec {
  readonly key: string;
  readonly label: string;
  readonly type: 'boolean';
  readonly default: boolean;
  readonly chart: ChartRole;
  readonly why: string;
  readonly source: string;
}

export type ParamSpec = NumericParamSpec | BooleanParamSpec;

export type ParamValue = number | boolean;

/** What an instance supplies. Absent keys fall back to the spec default. */
export type ParamValues = Record<string, ParamValue | null | undefined>;

export interface ResolvedParams {
  readonly values: Readonly<Record<string, ParamValue>>;
  /** Non-empty means something was clamped, dropped or unknown. Never discarded by the caller. */
  readonly warnings: readonly string[];
}

/** Thrown by `validateSupplied()` at a write boundary. Carries every problem, not just the first. */
export class ParamValidationError extends Error {
  readonly problems: readonly string[];
  constructor(directiveId: string, problems: readonly string[]) {
    super(`Invalid parameters for directive "${directiveId}": ${problems.join('; ')}`);
    this.name = 'ParamValidationError';
    this.problems = problems;
  }
}

function isNumeric(spec: ParamSpec): spec is NumericParamSpec {
  return spec.type === 'number';
}

/**
 * Resolve supplied values against the spec, on the READ path. Never throws.
 *
 * - an absent (or `null` / `undefined`) key yields the declared default;
 * - a numeric value is clamped into `[min, max]` and a warning is recorded;
 * - a value of the wrong type is IGNORED with a warning and the default is used — the default is the
 *   known-good production value, so falling back to it is the safe direction;
 * - an unknown key is REPORTED, never silently dropped, because a silently ignored typo is
 *   indistinguishable from a parameter that does nothing.
 */
export function resolveParams(
  directiveId: string,
  specs: readonly ParamSpec[],
  supplied?: ParamValues | null,
): ResolvedParams {
  const values: Record<string, ParamValue> = {};
  const warnings: string[] = [];
  const byKey = new Map(specs.map((s) => [s.key, s]));

  for (const spec of specs) {
    const raw = supplied ? supplied[spec.key] : undefined;
    if (raw === undefined || raw === null) {
      values[spec.key] = spec.default;
      continue;
    }
    if (isNumeric(spec)) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        warnings.push(`"${spec.key}" expected a finite number, got ${describeValue(raw)}; using default ${spec.default}`);
        values[spec.key] = spec.default;
        continue;
      }
      const clamped = Math.min(spec.max, Math.max(spec.min, raw));
      if (clamped !== raw) {
        warnings.push(`"${spec.key}" ${raw} is outside [${spec.min}, ${spec.max}]; clamped to ${clamped}`);
      }
      values[spec.key] = clamped;
      continue;
    }
    if (typeof raw !== 'boolean') {
      warnings.push(`"${spec.key}" expected a boolean, got ${describeValue(raw)}; using default ${spec.default}`);
      values[spec.key] = spec.default;
      continue;
    }
    values[spec.key] = raw;
  }

  if (supplied) {
    for (const key of Object.keys(supplied)) {
      if (byKey.has(key)) continue;
      // ⚠️ Reported rather than dropped. A UI that sends `rsiPerod` and gets no error will tune
      // nothing and the user will believe it worked.
      warnings.push(`unknown parameter "${key}" for directive "${directiveId}" — ignored`);
    }
  }

  return { values, warnings };
}

/**
 * Validate supplied values at a WRITE boundary and THROW on any problem.
 *
 * Deliberately stricter than `resolveParams()`: an out-of-range value is a refusal here, not a clamp,
 * because a human is present and silently storing a different number than they asked for is the
 * surprise this split exists to prevent.
 */
export function validateSupplied(
  directiveId: string,
  specs: readonly ParamSpec[],
  supplied: ParamValues | null | undefined,
): void {
  if (!supplied) return;
  const byKey = new Map(specs.map((s) => [s.key, s]));
  const problems: string[] = [];

  for (const [key, raw] of Object.entries(supplied)) {
    const spec = byKey.get(key);
    if (!spec) {
      problems.push(`unknown parameter "${key}" (known: ${specs.map((s) => s.key).join(', ') || 'none'})`);
      continue;
    }
    if (raw === null || raw === undefined) continue;
    if (isNumeric(spec)) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        problems.push(`"${key}" must be a finite number, got ${describeValue(raw)}`);
      } else if (raw < spec.min || raw > spec.max) {
        problems.push(`"${key}" ${raw} is outside [${spec.min}, ${spec.max}]`);
      }
      continue;
    }
    if (typeof raw !== 'boolean') {
      problems.push(`"${key}" must be a boolean, got ${describeValue(raw)}`);
    }
  }

  if (problems.length) throw new ParamValidationError(directiveId, problems);
}

/** The declared defaults as a plain object — what "no parameters supplied" resolves to. */
export function defaultParams(specs: readonly ParamSpec[]): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const spec of specs) out[spec.key] = spec.default;
  return out;
}

/**
 * A spec is only well-formed if it could not mislead a UI.
 * Duplicate keys would make one control silently shadow another; a default outside `[min, max]` would
 * render a control that snaps away from its own starting value the first time it is touched.
 */
export function specProblems(specs: readonly ParamSpec[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.key)) problems.push(`duplicate parameter key "${spec.key}"`);
    seen.add(spec.key);
    if (isNumeric(spec)) {
      if (spec.min > spec.max) problems.push(`"${spec.key}" has min ${spec.min} > max ${spec.max}`);
      if (spec.default < spec.min || spec.default > spec.max) {
        problems.push(`"${spec.key}" default ${spec.default} is outside [${spec.min}, ${spec.max}]`);
      }
    }
    if (!spec.why || spec.why.trim().length < 20) {
      problems.push(`"${spec.key}" needs a \`why\` explaining the measurement that makes it tunable`);
    }
    if (!spec.source || !spec.source.includes(':')) {
      problems.push(`"${spec.key}" needs a \`source\` of the form file:line naming the constant it replaces`);
    }
    // ⚠️ A knob with no rendering path is a buried ability. `none` is a legitimate answer, but the
    // field must be CHOSEN — an omitted role would leave the UI with nothing to draw and no signal
    // that the directive needs the dynamic/temporal visual instead.
    if (!spec.chart) {
      problems.push(`"${spec.key}" needs a \`chart\` role (one of ${CHART_ROLES.join(', ')}; use 'none' for a knob that cannot be charted)`);
    } else if (!CHART_ROLES.includes(spec.chart)) {
      problems.push(`"${spec.key}" has unknown chart role "${spec.chart}" (one of ${CHART_ROLES.join(', ')})`);
    }
  }
  return problems;
}

function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}
