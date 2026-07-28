/**
 * CAD/USD Oil Correlation Directive
 * ===================================
 * Evaluates Canadian dollar pairs in context of the primary CAD driver:
 * crude oil prices. CAD is a petrocurrency — oil and CAD move together.
 *
 * ── Key Relationships ────────────────────────────────────
 * WTI crude ↑ (oil up)      → bullish CAD (USDCAD ↓, EURCAD ↓, etc.)
 * WTI crude ↓ (oil down)    → bearish CAD (USDCAD ↑)
 * DXY ↑ (strong USD)        → USDCAD rises (USD leg dominates)
 * BOC rate vs Fed rate      → wider spread = stronger CAD
 *
 * ── Symbol Coverage ──────────────────────────────────────
 * USDCAD, EURCAD, GBPCAD, AUDCAD, NZDCAD
 *
 * ── Data Sources ─────────────────────────────────────────
 * dxyValue or eurusdValue on DirectiveInput (DXY pipeline)
 * wtiValue on DirectiveInput (MT5 USOIL quote, optional)
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

// ── Thresholds ────────────────────────────────────────────

const DXY_STRONG = 105;
const DXY_WEAK = 101;

// ── CAD pair detection ────────────────────────────────────

const CAD_PAIRS = new Set([
  'USDCAD', 'EURCAD', 'GBPCAD', 'AUDCAD', 'NZDCAD',
]);

// ── Directive ─────────────────────────────────────────────

@Injectable()
export class CadUsdOilCorrelationDirective implements IDirective {
  readonly id = 'cad-usd-oil-correlation';
  readonly name = 'CAD/USD Oil Correlation';
  readonly description =
    'CAD petrocurrency vs WTI crude oil and USD strength. ' +
    'Oil up = CAD up (USDCAD down). Covers all 5 CAD crosses.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 20 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    let dxy = (input as any).dxyValue as number | undefined;
    const eurusd = (input as any).eurusdValue as number | undefined;
    const wti = (input as any).wtiValue as number | undefined;

    const sym = input.symbol.toUpperCase();

    // Only score CAD pairs
    if (!CAD_PAIRS.has(sym)) {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0,
        reason: `${input.symbol} is not a CAD pair — cad-usd-oil-correlation only applies to USDCAD/EURCAD/GBPCAD/AUDCAD/NZDCAD.`,
      };
    }

    // ── EURUSD proxy fallback ─────────────────────────────
    let dxySource = 'DXY';
    if ((dxy === undefined || dxy <= 0) && eurusd !== undefined && eurusd > 0) {
      if (eurusd >= 1.15) dxy = 98;
      else if (eurusd >= 1.08) dxy = 103;
      else dxy = 108;
      dxySource = 'EURUSD proxy';
    }

    // ── No macro data at all ──────────────────────────────
    if (dxy === undefined || dxy <= 0) {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0.10,
        reason: `No DXY or EURUSD macro data for ${sym}. CAD correlation requires USD strength data. Connect MT5 (EURUSD always available).`,
      };
    }

    // ── Score each driver ─────────────────────────────────
    const drivers: { label: string; score: number; weight: number }[] = [];

    // Driver 1: DXY / USD strength (weight: 0.40)
    // CAD pairs with USD as BASE (USDCAD): USD up = pair UP → bullish for pair
    // CAD pairs with USD as QUOTE: USD up = pair DOWN → bearish
    const isUsdBase = sym === 'USDCAD';

    if (dxy >= 108) {
      const score = isUsdBase ? 80 : 20;
      drivers.push({ label: `extreme USD strength (${dxySource}=${dxy})`, score, weight: 0.40 });
    } else if (dxy >= DXY_STRONG) {
      const score = isUsdBase ? 70 : 30;
      drivers.push({ label: `strong USD (${dxySource}=${dxy})`, score, weight: 0.40 });
    } else if (dxy <= DXY_WEAK) {
      const score = isUsdBase ? 30 : 70;
      drivers.push({ label: `weak USD (${dxySource}=${dxy})`, score, weight: 0.40 });
    } else {
      drivers.push({ label: `neutral USD (${dxySource}=${dxy})`, score: 50, weight: 0.40 });
    }

    // Driver 2: WTI crude oil (weight: 0.45 — primary CAD driver)
    if (wti !== undefined && wti > 0) {
      // Oil price context: "high" and "low" are relative to recent ranges
      // $80+ = strong oil = CAD tailwind
      // $60- = weak oil = CAD headwind
      if (wti >= 85) {
        drivers.push({ label: `strong oil (WTI=$${wti.toFixed(0)})`, score: 75, weight: 0.45 });
      } else if (wti >= 75) {
        drivers.push({ label: `firm oil (WTI=$${wti.toFixed(0)})`, score: 60, weight: 0.45 });
      } else if (wti <= 60) {
        drivers.push({ label: `weak oil (WTI=$${wti.toFixed(0)})`, score: 25, weight: 0.45 });
      } else {
        drivers.push({ label: `moderate oil (WTI=$${wti.toFixed(0)})`, score: 50, weight: 0.45 });
      }
    } else {
      // No oil data — redistribute to DXY
      drivers[0].weight += 0.30;
    }

    // ── Normalize weights ─────────────────────────────────
    const totalWeight = drivers.reduce((s, d) => s + d.weight, 0);
    let weightedScore = 0;
    const parts: string[] = [];
    for (const d of drivers) {
      const normalizedWeight = d.weight / totalWeight;
      weightedScore += d.score * normalizedWeight;
      parts.push(`${d.label}: ${d.score}/100 (wt ${(normalizedWeight * 100).toFixed(0)}%)`);
    }

    weightedScore = Math.round(weightedScore);

    // ── Signal classification ─────────────────────────────
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (weightedScore >= 65) signalClass = 'bullish';
    else if (weightedScore <= 35) signalClass = 'bearish';
    else signalClass = 'neutral';

    const hasOil = wti !== undefined && wti > 0;
    const confidence = hasOil ? 0.50 : 0.30;

    return {
      signalClass,
      score: weightedScore,
      confidence,
      reason: `${sym} (${isUsdBase ? 'USD base' : 'CAD cross'}): ${parts.join('; ')} → composite=${weightedScore}`,
    };
  }
}
