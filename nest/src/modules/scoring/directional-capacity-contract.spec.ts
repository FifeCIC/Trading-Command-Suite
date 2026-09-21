/**
 * directional-capacity-contract.spec.ts — guards a decision that was REVERTED once
 * =============================================================================
 * Created 2026-09-11.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The project owner asked why areas keep being re-opened. Investigation on
 * 2026-09-11 found that one specific decision has **already been tried and
 * reverted once**, for a reason that had to be re-discovered from 7 days of data.
 * That is the most expensive kind of loop, and it is recorded here so the next
 * agent hits a failing test instead of a blank sheet.
 *
 * THE DECISION (see `docs/SETTLED-DECISIONS.md` row 9, and ADR-011)
 * -----------------------------------------------------------------
 * `capacityMax` — the denominator of every protocol percentage — accumulates the
 * `maxScore` of every directive that is **direction-eligible by CONFIG**:
 *
 *     if (!isGateGroup) { capacityMax += maxScore; directionEligibleCount++; }
 *
 * ⚠️ `!isGateGroup` ALONE IS CORRECT. **Do NOT add a `directionBias` test here.**
 *
 * WHY NOT — the measurement that settled it
 * -----------------------------------------
 * #761 proposed requiring `directionBias ∈ {bullish, bearish}` on the grounds that a
 * directive which can never emit a direction is "unreachable denominator". It sounds
 * right. It was tried on 2026-09-10 and **reverted**, because the premise is false:
 * **declared bias massively UNDERSTATES what directives actually emit.**
 *
 * Measured over 7 days of recorded breakdowns:
 *
 *     directive                  declares    directional hits at runtime
 *     support-resistance-levels  ?            11,129
 *     analyst-adjustments        ?             8,746
 *     macd-crossover             neutral       5,252
 *     gold-macro-correlation     neutral       4,703
 *     gold-round-numbers         neutral       3,890
 *     speed-momentum             neutral       2,854
 *
 * Gating capacity on `directionBias` therefore EXCLUDES the directives doing most of
 * the real work and SHRINKS every denominator — making the percentages worse, not
 * better. A directive that declares `neutral` and fires directionally 5,252 times is
 * not unreachable; the declaration is unreliable.
 *
 * WHY A TEST AND NOT A COMMENT
 * ----------------------------
 * The existing warning lives in a code comment inside a 900-line service, which an
 * agent editing for an unrelated reason will not read. The genuine question in #761 —
 * "does capacity include points the numerator cannot reach?" — is real, but it
 * **cannot be answered from config**. It must be measured from OUTCOMES via
 * `scripts/analyse-unreachable-capacity.cjs`. This test makes the *config-based*
 * shortcut fail loudly so nobody re-derives it.
 *
 * ⚠️ IF THIS TEST FAILS, YOU HAVE PROBABLY RE-INTRODUCED THE REVERTED FIX.
 *    Do not "fix" the test. Re-read `docs/SETTLED-DECISIONS.md` row 9 first.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read the gating service source.
 *
 * This is a SOURCE-LEVEL assertion rather than a behavioural one, deliberately.
 * The property being protected is "capacity does not consult `directionBias`" — a
 * statement about what the code must NOT do. A behavioural test would need a
 * fixture exercising every directive category, and would pass for the wrong reason
 * if someone added the check behind a flag.
 */
const GATING_SERVICE = join(
  __dirname,
  'protocol-gating.service.ts',
);
const source = readFileSync(GATING_SERVICE, 'utf8');

/** Strip comments, so a commented-out guard cannot satisfy or violate this spec. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('directional capacity contract (ADR-011, SETTLED-DECISIONS row 9)', () => {
  it('capacity accumulates on `!isGateGroup` — the marker is still present', () => {
    // If this disappears, the capacity model changed and every percentage in the
    // system changed with it. That is a contract change, not a refactor.
    expect(code).toMatch(/capacityMax\s*\+=/);
    expect(code).toMatch(/!isGateGroup/);
  });

  it('capacity does NOT consult `directionBias` — the reverted fix stays reverted', () => {
    // The defect this guards: `capacityMax += maxScore` nested inside a
    // `directionBias === 'bullish' || directionBias === 'bearish'` condition.
    //
    // Find the capacity accumulation and assert `directionBias` is not part of the
    // condition that reaches it. A window of 12 lines covers the enclosing `if`.
    const idx = code.indexOf('capacityMax +=');
    expect(idx).toBeGreaterThan(-1);

    const windowStart = Math.max(0, idx - 600);
    const window = code.slice(windowStart, idx);

    expect(window).not.toMatch(/directionBias/);
  });

  it('capacity does not consult the runtime signalClass either (#758, second pass)', () => {
    // The FIRST fix for #758 still read a RUNTIME value here, so the denominator
    // remained market-dependent: measured live, `forex-session-v1` wrote FIVE
    // different denominators in 30 minutes (470/560/390/480/410).
    //
    // Direction-ELIGIBILITY is a property of the CONFIG. Whether a directive happens
    // to read neutral or bullish THIS minute changes the numerator only.
    const idx = code.indexOf('capacityMax +=');
    const window = code.slice(Math.max(0, idx - 600), idx);

    // `configured` capacity must not be gated on what fired this tick.
    expect(window).not.toMatch(/result\.signalClass/);
  });

  it('the capacity model documents why `directionBias` is excluded', () => {
    // The reasoning must survive INSIDE the file, because an agent editing this
    // service will not open SETTLED-DECISIONS.md. If someone removes the
    // explanation, this fails before they can remove the behaviour.
    expect(source).toMatch(/directionBias/);
    expect(source.toLowerCase()).toMatch(/reverted|do not add/);
  });

  it('gate groups are excluded from capacity (a gate is a hurdle, not conviction)', () => {
    // `if (!isGateGroup) { capacityMax += maxScore; }` — the guard is what makes a
    // risk gate a multiplier rather than a score contribution. Removing it would
    // inflate every denominator by the gate maxScores.
    const m = code.match(/if\s*\(\s*!isGateGroup\s*\)\s*\{[^}]*capacityMax\s*\+=/);
    expect(m).not.toBeNull();
  });
});

/**
 * #906 (2026-09-21) — the SAME settled decision, enforced on the health service.
 *
 * `protocol-health.service.ts` used to emit a per-protocol
 * `low-declared-directional-capacity` warning derived from `directionBias`
 * config — the very config-derived verdict this file exists to keep reverted.
 * It fired for 14 of 17 protocols: one structural cause, fourteen alarms,
 * while its own text admitted the number understated what it claimed to
 * measure. Retired; the evidence-based `ceiling-below-threshold` audit is the
 * actionable replacement.
 *
 * ⚠️ IF THIS FAILS, SOMEONE IS REINTRODUCING A CONFIG-DERIVED CAPACITY VERDICT.
 *    Do not "fix" the test — measure outcomes instead (auditMeasuredCeilings).
 */
describe('protocol-health must not re-derive a capacity verdict from config (#906)', () => {
  const HEALTH_SERVICE = join(__dirname, 'protocol-health.service.ts');
  const healthSource = readFileSync(HEALTH_SERVICE, 'utf8');
  const healthCode = healthSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('does not emit the retired per-protocol kind', () => {
    expect(healthCode).not.toMatch(/low-declared-directional-capacity/);
  });

  it('keeps the retirement reasoning in-file', () => {
    expect(healthSource).toMatch(/RETIRED 2026-09-21 \(#906\)/);
    expect(healthSource).toMatch(/understates/i);
  });
});
