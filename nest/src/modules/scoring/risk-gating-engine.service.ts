import { Injectable, Logger } from '@nestjs/common';

/**
 * RiskGatingEngine — multi-tiered multiplicative risk gating.
 *
 * Replaces simple single-multiplier approach with:
 *   - Hard gates: can veto a trade entirely (score → 0)
 *   - Soft modifiers: adjust proportionally based on severity
 *   - Regime overrides: change directional bias
 *   - Cascading multiplication: each rule compounds
 *
 * Principle: catastrophic structural risk cannot be drowned out by good RSI.
 */
@Injectable()
export class RiskGatingEngine {
  private readonly logger = new Logger(RiskGatingEngine.name);

  /**
   * Apply all risk rules to a score in sequence.
   * Returns the gated score, multiplier chain, and reasons.
   */
  apply(
    baseScore: number,
    riskDirectives: RiskDirectiveResult[],
  ): RiskGateResult {
    if (!riskDirectives.length) {
      return {
        finalScore: baseScore,
        multiplier: 1.0,
        multiplierChain: [],
        hardGateTriggered: false,
        hardGateReason: null,
        warnings: [],
        riskScore: 50, // neutral
      };
    }

    let currentScore = baseScore;
    const chain: MultiplierStep[] = [];
    const warnings: string[] = [];
    let hardGateTriggered = false;
    let hardGateReason: string | null = null;
    let cumulativeMultiplier = 1.0;
    let totalRiskWeight = 0;
    let weightedRiskSum = 0;

    for (const directive of riskDirectives) {
      const rule = this.classifyRule(directive);

      // UNMEASURED — no reading, so no risk. Skipped BEFORE the weight/severity
      // accumulators below, which would otherwise drag `riskScore` toward
      // "extreme risk" on the strength of a directive that admitted it could not
      // see anything (2026-09-10).
      if (rule.tier === 'unmeasured') {
        chain.push({
          directiveId: directive.directiveId,
          name: directive.name,
          tier: 'unmeasured',
          severity: 0,
          multiplier: 1.0,
          reason: rule.reason,
          cumulativeMultiplier,
        });
        continue;
      }

      // Track every classified rule before the control-flow branches below.
      // The former placement was unreachable because every branch continued or
      // broke, leaving riskScore permanently at its neutral default.
      totalRiskWeight += rule.weight;
      weightedRiskSum += rule.severity * rule.weight;

      if (rule.tier === 'hard_gate' && rule.severity >= 0.8) {
        // HARD GATE: trade is structurally unsafe — veto
        hardGateTriggered = true;
        hardGateReason = rule.reason;
        currentScore = 0;
        cumulativeMultiplier = 0;
        chain.push({
          directiveId: directive.directiveId,
          name: directive.name,
          tier: 'hard_gate',
          severity: rule.severity,
          multiplier: 0,
          reason: rule.reason,
          cumulativeMultiplier: 0,
        });
        warnings.push(`🚫 HARD GATE: ${directive.name} — ${rule.reason}`);
        break; // Stop processing — trade is vetoed
      }

      if (rule.tier === 'hard_gate') {
        // Lower-severity hard gate — strong penalty but not full veto
        const penalty = 1 - rule.severity;
        currentScore *= penalty;
        cumulativeMultiplier *= penalty;
        chain.push({
          directiveId: directive.directiveId,
          name: directive.name,
          tier: 'hard_gate',
          severity: rule.severity,
          multiplier: penalty,
          reason: rule.reason,
          cumulativeMultiplier,
        });
        warnings.push(`⚠️ NEAR-GATE: ${directive.name} (${(rule.severity * 100).toFixed(0)}%) — ${rule.reason}`);
        continue;
      }

      if (rule.tier === 'soft_modifier') {
        // Soft modifier: scales proportionally
        const modifier = 1 - (rule.severity * rule.weight);
        currentScore *= modifier;
        cumulativeMultiplier *= modifier;
        chain.push({
          directiveId: directive.directiveId,
          name: directive.name,
          tier: 'soft_modifier',
          severity: rule.severity,
          multiplier: modifier,
          reason: rule.reason,
          cumulativeMultiplier,
        });
        if (rule.severity > 0.5) {
          warnings.push(`⚠️ ${directive.name}: ${rule.reason}`);
        }
        continue;
      }

      if (rule.tier === 'regime_override') {
        // Regime: adjusts directional bias rather than score magnitude
        // Stored as metadata — applied by caller
        chain.push({
          directiveId: directive.directiveId,
          name: directive.name,
          tier: 'regime_override',
          severity: rule.severity,
          multiplier: 1.0, // Doesn't multiply score
          reason: rule.reason,
          cumulativeMultiplier,
          regimeOverride: rule.regimeDirection,
        });
        continue;
      }

    }

    // Safety floor ONLY — prevents runaway compounding producing zero/negative
    // scores. No 0.5 cap: multiple moderate risks SHOULD compound (e.g. high
    // correlation + high volatility + near rollover) and drive the score toward
    // the threshold that blocks the trade. Hard gates still veto fully above this.
    cumulativeMultiplier = hardGateTriggered ? 0 : Math.max(0.05, cumulativeMultiplier);

    // Compute aggregate risk score (0-100, inverted: 0 = safe, 100 = extreme risk)
    const riskScore = totalRiskWeight > 0
      ? Math.round((weightedRiskSum / totalRiskWeight) * 100)
      : 50;

    return {
      finalScore: Math.round(currentScore),
      multiplier: Math.round(cumulativeMultiplier * 1000) / 1000,
      multiplierChain: chain,
      hardGateTriggered,
      hardGateReason,
      warnings: [...new Set(warnings)],
      riskScore,
    };
  }

  /**
   * Classify a risk directive result into a tiered rule.
   */
  private classifyRule(directive: RiskDirectiveResult): ClassifiedRule {
    // ⚠️ UNMEASURED GUARD — checked BEFORE any severity maths (added 2026-09-10).
    //
    // `severity = 1 - score/maxScore` maps an unmeasured zero (score 0) to
    // severity 1.0, the MOST dangerous possible reading. That inversion is the
    // bug: "I could not measure this" was being scored as "this is catastrophically
    // bad", so a directive's own stale-data guard tripped its own hard gate.
    //
    // Live evidence: `liquidity-check` returns score 0 when its stale-data guard
    // fires. That made severity 1.0 → the `severity > 0.9` HARD GATE vetoed the
    // trade with the false reason "Symbol liquidity too low — cannot execute at
    // acceptable spread". Over 45 minutes `spy-day-v1` (11 ticks), `qqq-day-v1`
    // (11) and `spy-speed-v1` (7) were hard-gated on EVERY tick, and `xau-speed-v1`
    // on 12 of 22 — the same symbol oscillating between "highly liquid 94/100"
    // and "Market closed" seconds apart.
    //
    // An unmeasured directive contributes NO penalty and NO veto: it is absent
    // from the risk picture, exactly as a neutral reading with no data should be.
    // This is the risk-side twin of INV-STABLE-DENOMINATOR — absence of evidence
    // must not be scored as evidence, in either the numerator or the gate.
    if (directive.unmeasured) {
      return {
        tier: 'unmeasured',
        severity: 0,
        weight: 0,
        reason: directive.reason || `${directive.name}: no reading this tick`,
      };
    }

    // Normalized score 0-1 (lower = worse for risk directives)
    const normalizedScore = directive.maxScore > 0
      ? Math.max(0, Math.min(1, directive.score / directive.maxScore))
      : 0;
    const severity = 1 - normalizedScore; // High severity = low score = dangerous

    // ── Rule classification by directive type ──

    switch (directive.directiveId) {
      // HARD GATES — can veto trades
      case 'budget-gate':
        // Budget exhausted → no more trades today
        if (severity > 0.7) {
          return { tier: 'hard_gate', severity, weight: 1.0, reason: 'Daily loss limit exceeded — no new positions allowed' };
        }
        return { tier: 'soft_modifier', severity, weight: 0.4, reason: `Budget utilization at ${(severity * 100).toFixed(0)}%` };

      case 'position-concentration':
        if (severity > 0.8) {
          return { tier: 'hard_gate', severity, weight: 1.0, reason: 'Position concentration critical — portfolio overexposed to single symbol/sector' };
        }
        return { tier: 'soft_modifier', severity, weight: 0.3, reason: `Position concentration elevated — ${(severity * 100).toFixed(0)}% of limit` };

      case 'liquidity-check':
        if (severity > 0.9) {
          return { tier: 'hard_gate', severity, weight: 1.0, reason: 'Symbol liquidity too low — cannot execute at acceptable spread' };
        }
        return { tier: 'soft_modifier', severity, weight: 0.25, reason: `Spread/liquidity concern (${(severity * 100).toFixed(0)}%)` };

      // SOFT MODIFIERS — scale proportionally
      case 'correlation-drag':
        return { tier: 'soft_modifier', severity, weight: 0.25, reason: `High correlation with existing positions — diversification penalty` };

      case 'dilution-impact':
        return { tier: 'soft_modifier', severity, weight: 0.2, reason: severity > 0.5 ? 'Significant shareholder dilution detected' : 'Minor dilution concern' };

      case 'volatility-regime':
        return { tier: 'soft_modifier', severity, weight: 0.3, reason: severity > 0.7 ? 'Extreme volatility regime — reduce position size' : 'Elevated volatility — caution' };

      case 'rollover-risk':
        return { tier: 'soft_modifier', severity, weight: 0.15, reason: severity > 0.5 ? 'Near contract rollover — watch for spread widening' : 'Rollover period approaching' };

      // REGIME OVERRIDE — changes directional bias
      case 'dxy-regime':
        return {
          tier: 'regime_override',
          severity,
          weight: 0.7,
          reason: severity > 0.7 ? 'Strong USD — bearish for commodities/forex' : severity < 0.3 ? 'Weak USD — bullish for commodities/forex' : 'DXY neutral',
          regimeDirection: severity > 0.7 ? 'bearish' : severity < 0.3 ? 'bullish' : null,
        };

      default:
        return { tier: 'soft_modifier', severity, weight: 0.15, reason: directive.reason || `Risk signal: ${(severity * 100).toFixed(0)}%` };
    }
  }
}

// ── Types ─────────────────────────────────────────────────

export interface RiskDirectiveResult {
  directiveId: string;
  name: string;
  score: number;    // Raw score (lower = more risk)
  maxScore: number;
  reason: string;
  /**
   * True when the directive could not take a reading this tick (stale data,
   * insufficient bars). An unmeasured result contributes no penalty and can
   * NEVER trip a hard gate — see the guard in `classifyRule` (2026-09-10).
   */
  unmeasured?: boolean;
}

export interface MultiplierStep {
  directiveId: string;
  name: string;
  tier: 'hard_gate' | 'soft_modifier' | 'regime_override' | 'unmeasured';
  severity: number;          // 0-1 (0 = safe, 1 = extreme risk)
  multiplier: number;        // Applied multiplier (1 = no change, 0 = veto)
  reason: string;
  cumulativeMultiplier: number;
  regimeOverride?: 'bullish' | 'bearish' | null;
}

export interface RiskGateResult {
  finalScore: number;
  multiplier: number;
  multiplierChain: MultiplierStep[];
  hardGateTriggered: boolean;
  hardGateReason: string | null;
  warnings: string[];
  riskScore: number;         // 0-100 (0 = safe, 100 = extreme risk)
}

interface ClassifiedRule {
  tier: 'hard_gate' | 'soft_modifier' | 'regime_override' | 'unmeasured';
  severity: number;
  weight: number;
  reason: string;
  regimeDirection?: 'bullish' | 'bearish' | null;
}
