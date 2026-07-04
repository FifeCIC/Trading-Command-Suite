/**
 * Liquidity Check
 * ===============
 * Penalises symbols with poor liquidity conditions — wide spreads,
 * low volume depth, or large market-cap-adjusted gaps.
 *
 * This directive acts as a RISK GATE — it doesn't produce directional
 * signals. It returns high scores for liquid symbols (good to trade)
 * and low/zero scores for illiquid ones (avoid).
 *
 * Heuristic (no spread data available in MarketBar):
 * - Volume stability: coefficient of variation of recent volume
 * - Range consistency: low range volatility = tight spreads → liquid
 * - Gap frequency: bars with large opens gaps suggest illiquidity
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const MIN_BARS = 20;

@Injectable()
export class LiquidityCheckDirective implements IDirective {
  readonly id = 'liquidity-check';
  readonly name = 'Liquidity Check';
  readonly description =
    'Penalises illiquid symbols. Rewards symbols with stable volume, tight ranges, and low gap frequency.';
  readonly priority = 65;
  readonly maxScore = 80; // Risk gate — lower ceiling than directional signals
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;

    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const recent = bars.slice(-MIN_BARS);

    // 1. Volume stability (higher = more liquid)
    const volumes = recent.map(b => b.volume);
    const avgVol = volumes.reduce((s, v) => s + v, 0) / volumes.length;
    const volStdDev = Math.sqrt(
      volumes.reduce((s, v) => s + (v - avgVol) ** 2, 0) / volumes.length
    );
    const volCV = avgVol > 0 ? volStdDev / avgVol : 999;
    // CV < 0.5 = stable volume (liquid), CV > 2 = erratic (illiquid)
    const volumeScore = Math.max(0, Math.min(40, (1 - Math.min(volCV, 2) / 2) * 40));

    // 2. Range tightness (tighter ranges = more liquid)
    const ranges = recent.map(b => {
      const mid = (b.high + b.low) / 2;
      return mid > 0 ? (b.high - b.low) / mid : 0; // guard: 0/0 → 0
    });
    const avgRange = ranges.reduce((s, r) => s + r, 0) / ranges.length;
    // < 1% range = very liquid (score 35), > 5% = illiquid (score 0)
    const rangeScore = Math.max(0, Math.min(35, (1 - Math.min(avgRange, 0.05) / 0.05) * 35));

    // 3. Gap frequency (fewer gaps = more liquid)
    let gapCount = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i - 1].close <= 0) continue; // guard: skip bad data
      const gapPct = Math.abs(recent[i].open - recent[i - 1].close) / recent[i - 1].close;
      if (gapPct > 0.02) gapCount++; // >2% gap = illiquid
    }
    const gapFreq = gapCount / (recent.length - 1);
    // 0 gaps = score 25, all gaps = score 0
    const gapScore = Math.max(0, Math.min(25, (1 - gapFreq) * 25));

    const totalScore = Math.round(volumeScore + rangeScore + gapScore);

    // Risk assessment
    let riskLabel: string;
    if (totalScore >= 70) riskLabel = 'highly liquid';
    else if (totalScore >= 50) riskLabel = 'adequately liquid';
    else if (totalScore >= 30) riskLabel = 'moderate liquidity concern';
    else riskLabel = 'low liquidity — avoid large positions';

    return {
      score: totalScore,
      confidence: 0.75,
      reason: `${riskLabel}. Vol CV=${volCV.toFixed(2)}, Range=${(avgRange * 100).toFixed(1)}%, Gaps=${(gapFreq * 100).toFixed(0)}%. Score: vol=${volumeScore.toFixed(0)} + range=${rangeScore.toFixed(0)} + gap=${gapScore.toFixed(0)} = ${totalScore}/${this.maxScore}.`,
      signalClass: 'neutral',
    };
  }
}
