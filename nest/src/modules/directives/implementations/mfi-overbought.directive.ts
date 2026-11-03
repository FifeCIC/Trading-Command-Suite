/**
 * MFI Overbought Warning — the BEARISH mirror of `mfi` (created 2026-11-03, #1181).
 * =================================================================================
 * ⚠️ WHY THIS EXISTS AS A SEPARATE CLASS, NOT A CHANGE TO `mfi`.
 *
 * `mfi` measures only the OVERSOLD side: BASE runs `mapRange(MFI, 80 → 20, 0 → 50)`, so a LOW MFI
 * scores high, and `signalClass` is `total >= 60 ? 'bullish' : 'neutral'`. There is no overbought
 * branch at all — measured 2026-11-03, it emitted **0 bearish** in 300 ticks, so inside a
 * SHORT_ONLY protocol its 105 maxScore was capacity that could never be earned (63 such instances
 * across 18 active protocols).
 *
 * The obvious "fix" is to add a bearish branch to `mfi`. That is REJECTED:
 *   • `mfi` has performance history (35 protocols reference it). Editing it in place moves live
 *     scores, which is a maths change and needs a copied configuration
 *     (`maths-change-requires-abi.instructions.md`).
 *   • The repo already answers this shape with TWO classes — `rsi-oversold` (bullish) and
 *     `rsi-overbought` (bearish) — not one two-sided class. Following the canonical pattern means a
 *     protocol composer chooses which side(s) it wants, and `directionBias` stays honest.
 * So this is an ADDITIVE mirror: `mfi` is untouched, and a protocol may now carry either or both.
 *
 * ── The mirror, exactly ──────────────────────────────────────────────────────────
 *  mfi                         │  mfi-overbought (this class)
 *  ────────────────────────────┼────────────────────────────────────────────────
 *  BASE  MFI  80 → 0 pts       │  BASE  MFI  20 → 0 pts
 *        MFI  20 → 50 pts      │        MFI  80 → 50 pts
 *  BONUS MFI < 10 → +50        │  BONUS MFI > 90 → +50
 *        MFI < 20 → +30        │        MFI > 80 → +30
 *  CURL  rising      → +5      │  CURL  falling     → +5
 *  CLASS total>=60 → 'bullish' │  CLASS total>=60 → 'bearish'
 *  MAX   105                   │  MAX   105
 *
 * The tiers are DERIVED from one gate (`overboughtLevel`), mirroring how `mfi` derives its deep
 * tier from `oversoldLevel` — so tuning the gate keeps the ladder ordered instead of letting a
 * literal fall out of step.
 *
 * ⚠️ `mfi()` is directionless by nature — it is a volume-weighted RSI. Nothing here invents a
 * reading; it reads the SAME indicator from the opposite end of its range.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { mfi } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MFI_PERIOD = 14;
const OVERBOUGHT_LEVEL = 80;

/**
 * The deep tier sits midway from the gate to 100 — the exact mirror of `mfi`'s `oversoldLevel * 0.5`
 * (which reaches DOWN halfway to 0). At the production gate of 80 this resolves to 90.
 */
const DEEP_FRACTION = 1 / 2;

const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'mfiPeriod',
    label: 'MFI period',
    type: 'number',
    default: MFI_PERIOD,
    min: 2,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'The mirror of `mfi`: the period decides whether the overbought tiers are ever reached at all (#1166 method). 14 is the daily-chart convention and matches the bullish class so a comparison is like-for-like.',
    source: 'mfi-overbought.directive.ts:58 MFI_PERIOD',
  },
  {
    key: 'overboughtLevel',
    label: 'Overbought level',
    type: 'number',
    default: OVERBOUGHT_LEVEL,
    min: 60,
    max: 95,
    step: 1,
    chart: 'threshold',
    why: 'The gate that arms the bonus tiers, and the midpoint of the base curve. 80 is the conventional MFI overbought line and the exact mirror of the bullish class\'s 20, so a control/variant pair differs only in direction.',
    source: 'mfi-overbought.directive.ts:59 OVERBOUGHT_LEVEL',
  },
];

/** Mirror of the helper in `mfi.directive.ts` — same clamping, same name, so the two read alike. */
function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class MfiOverboughtDirective implements IDirective {
  readonly id = 'mfi-overbought';
  readonly name = 'MFI Overbought Warning';
  readonly description =
    'Bearish mirror of Money Flow Index: continuous base + bonuses above the overbought gate. Volume-weighted RSI read from the top of its range.';
  readonly category = 'oscillator' as const;
  readonly priority = 50;
  readonly maxScore = 105;
  readonly minScore = 1;
  readonly minBars = { '1d': MFI_PERIOD + 3 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;
  /** Declared, not implied: this class emits 'bearish' or 'neutral', never 'bullish'. */
  readonly directionBias = 'bearish' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const mfiPeriod = values.mfiPeriod as number;
    const overboughtLevel = values.overboughtLevel as number;
    // Halfway from the gate to 100 — mirrors `oversoldLevel * 0.5` reaching halfway to 0.
    const deepLevel = overboughtLevel + (100 - overboughtLevel) * DEEP_FRACTION;

    const highs = input.bars.map((b) => b.high);
    const lows = input.bars.map((b) => b.low);
    const closes = input.bars.map((b) => b.close);
    const volumes = input.bars.map((b) => b.volume);

    if (closes.length < mfiPeriod + 3) {
      return {
        signalClass: 'neutral',
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${mfiPeriod + 3} bars, have ${closes.length}.`,
      };
    }

    const mfiValues = mfi(highs, lows, closes, volumes, mfiPeriod);
    if (mfiValues.length < 3) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Not enough MFI values.' };
    }

    const currentMfi = mfiValues[mfiValues.length - 1];
    const prevMfi = mfiValues[mfiValues.length - 2];
    // Falling MFI from an overbought extreme is the bearish confirmation — the mirror of `mfi`,
    // which rewards a RISING MFI off an oversold extreme.
    const curlingDown = currentMfi < prevMfi;

    // BASE: MFI 20→0, MFI 80→50 (higher MFI = more overbought = higher base)
    const baseScore = Math.round(mapRange(currentMfi, 20, overboughtLevel, 0, 50));

    // BONUS tiers — deep first, so the ladder stays ordered if the gate is tuned.
    let bonusScore = 0;
    let bonusLabel = '';
    if (currentMfi > deepLevel) {
      bonusScore = 50;
      bonusLabel = `deep overbought (>${Math.round(deepLevel)})`;
    } else if (currentMfi > overboughtLevel) {
      bonusScore = 30;
      bonusLabel = `overbought (>${Math.round(overboughtLevel)})`;
    }

    const curlBonus = curlingDown ? 5 : 0;
    const total = baseScore + bonusScore + curlBonus;

    const parts = [`base=${baseScore}`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    if (curlBonus > 0) parts.push(`+${curlBonus} curl↓`);

    return {
      signalClass: total >= 60 ? 'bearish' : 'neutral',
      score: total,
      confidence: Number(
        (bonusScore > 0 ? 0.55 + (bonusScore / 50) * 0.3 : 0.3 + (baseScore / 50) * 0.2).toFixed(2),
      ),
      reason: `MFI(${mfiPeriod})=${currentMfi.toFixed(1)} ${curlingDown ? '↓' : '↑'}: ${parts.join(' ')}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, curlBonus, currentMfi, direction: 'bearish' },
    };
  }
}
