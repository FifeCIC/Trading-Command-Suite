/**
 * Earnings Proximity Directive — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * =======================================================================
 * Scores based on distance to next earnings date.
 * Mock-first — returns neutral when no earnings calendar data.
 *
 * ── Hybrid Scoring ─────────────────────────────────────────
 * BASE (40–55):  Continuous proximity interpolation: |days|=0→55, |days|=14→40.
 *                Closer to earnings = slightly elevated base.
 * BONUS tiers:   Within 1 day of earnings → +25 (heightened relevance).
 *                Within 3 days of earnings → +10.
 * MAX:           80 (55 base + 25 bonus).
 *
 * TradePress source: includes/scoring-system/directives/earnings-proximity.php
 *
 * ── Design decision (#626, 2026-08-16) ─────────────────────
 * Kept at `readiness: 'alpha'` and deliberately REMOVED from every scoring
 * protocol/strategy. Reason: `calculate()` reads `input.earningsDate`, which
 * no producer currently writes, so it would always hit the mock branch and
 * return a constant 45/100 — a phantom contribution that drags composites
 * toward neutral and inflates the denominator (the same disease #638 fixed
 * for gates). `directive-inclusion.ts` rule 1 already excludes `alpha` from
 * scoring, so the class stays registered (visible to the registry/audit) but
 * can never score until a real earnings feed is wired.
 *
 * Future (#648): rehome as a CATALYST directive in the stock screener — emit
 * an attention/earnings-proximity signal for watchlist promotion, not a
 * directional score inside a protocol composite.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/** Linear interpolation: map value from [inMin,inMax] to [outMin,outMax], clamped. */
function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class EarningsProximityDirective implements IDirective {
  readonly id = 'earnings-proximity';
  readonly name = 'Earnings Proximity';
  readonly description = 'Hybrid: continuous earnings-proximity base + within-window bonuses.';
  readonly priority = 50;
  readonly maxScore = 80;
  readonly minScore = 1; // 55 base + 25 bonus
  readonly minBars = { '1d': 1 };
  readonly version = '2.0.1'; // Hybrid scoring
  readonly requiredDataFeeds = ['earnings'];
  readonly readiness = 'alpha' as const; // demoted beta→alpha 2026-08-15 — mock-first: reads input.earningsDate which nothing writes; always returns mock 45
  readonly category = 'pattern' as const;
  readonly directionBias = 'bullish' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    // Check for earnings date on the input symbol data
    const meta = (input as any).earningsDate as string | undefined;
    const bars = input.bars;

    if (!meta) {
      // Mock mode — no earnings calendar connected
      return {
        signalClass: 'neutral',
        score: 45,
        confidence: 0.15,
        reason: `No earnings calendar data for ${input.symbol}. Mock-neutral score. Connect Alpha Vantage EARNINGS_CALENDAR for real data.`,
      };
    }

    const earningsDate = new Date(meta);
    const now = input.asOf ?? new Date();
    const lastBar = bars.length > 0 ? new Date(bars[bars.length - 1].timestamp) : now;
    const daysUntil = Math.ceil((earningsDate.getTime() - lastBar.getTime()) / (1000 * 60 * 60 * 24));
    const absDays = Math.abs(daysUntil);

    // ── BASE (continuous, 40–55) ──────────────────────────
    // |days|=0 (earnings day) → base 55
    // |days|=14+             → base 40
    const baseScore = Math.round(mapRange(absDays, 0, 14, 55, 40));

    // ── BONUS (threshold-gated) ───────────────────────────
    let bonusScore = 0;
    let bonusLabel = '';

    if (absDays <= 1) {
      bonusScore = 25;
      bonusLabel = daysUntil >= 0 ? 'earnings imminent' : 'just reported';
    } else if (absDays <= 3) {
      bonusScore = 10;
      bonusLabel = daysUntil >= 0 ? 'earnings approaching' : 'recent earnings';
    }

    // ── Total ─────────────────────────────────────────────
    const totalScore = baseScore + bonusScore;

    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (totalScore >= 60) signalClass = 'bullish';
    else signalClass = 'neutral';

    const confidence = bonusScore > 0 ? 0.4 : 0.25;

    const parts: string[] = [`base=${baseScore} (${absDays}d from earnings)`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    parts.push(`= ${totalScore}/${this.maxScore}`);

    return {
      signalClass,
      score: totalScore,
      confidence,
      reason: `${input.symbol}: ${parts.join(' ')}`,
      metadata: { baseScore, bonusScore, bonusLabel, daysUntil, absDays },
    };
  }
}
