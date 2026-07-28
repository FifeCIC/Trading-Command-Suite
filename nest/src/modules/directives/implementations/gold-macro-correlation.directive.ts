/**
 * Gold Macro Correlation Directive
 * =================================
 * Evaluates gold (XAUUSD, XAGUSD) in context of macro drivers:
 * USD strength (DXY), real yields, safe-haven demand.
 *
 * ── Key Relationships ────────────────────────────────────
 * DXY ↑ (strong USD)       → bearish gold (priced in USD)
 * DXY ↓ (weak USD)         → bullish gold
 * 10Y yield ↑ (rising)     → bearish gold (opportunity cost)
 * 10Y yield ↓ (falling)    → bullish gold
 * VIX ↑ (fear)             → bullish gold (safe haven)
 *
 * ── Data Sources ─────────────────────────────────────────
 * dxyValue or eurusdValue on DirectiveInput (from DXY pipeline)
 * treasury10Y on DirectiveInput (from Finnhub/FMP, optional)
 * vixValue on DirectiveInput (from VIX regime, optional)
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

// ── Thresholds ────────────────────────────────────────────

const DXY_STRONG = 105;
const DXY_WEAK = 101;
const YIELD_RISING = 4.5;   // 10Y > 4.5% = rising rate pressure
const YIELD_FALLING = 3.8;  // 10Y < 3.8% = falling rate tailwind
const VIX_FEAR = 25;        // VIX > 25 = safe-haven bid

// ── Directive ─────────────────────────────────────────────

@Injectable()
export class GoldMacroCorrelationDirective implements IDirective {
  readonly id = 'gold-macro-correlation';
  readonly name = 'Gold Macro Correlation';
  readonly description =
    'Gold vs USD strength (DXY), real yields (10Y), and safe-haven flows (VIX). ' +
    'Gold is the ultimate macro asset — DXY and real rates are the primary drivers.';
  readonly priority = 55;
  readonly maxScore = 100;
  readonly minBars = { '1d': 20 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    let dxy = (input as any).dxyValue as number | undefined;
    const eurusd = (input as any).eurusdValue as number | undefined;
    const yield10Y = (input as any).treasury10Y as number | undefined;
    const vix = (input as any).vixValue as number | undefined;

    const sym = input.symbol.toUpperCase();

    // Only score gold/silver — neutral for everything else
    if (sym !== 'XAUUSD' && sym !== 'XAGUSD' && sym !== 'XAU' && sym !== 'XAG') {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0,
        reason: `${input.symbol} is not a gold/silver symbol — gold-macro-correlation only applies to XAUUSD/XAGUSD.`,
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
        reason: `No DXY or EURUSD macro data for ${input.symbol}. Gold macro correlation requires USD strength data. Connect MT5 (EURUSD always available), Finnhub, or Alpha Vantage.`,
      };
    }

    // ── Score each macro driver ───────────────────────────
    const drivers: { label: string; score: number; weight: number }[] = [];

    // Driver 1: DXY / USD strength (weight: 0.45 — primary driver)
    if (dxy >= 108) {
      drivers.push({ label: `strong USD (${dxySource}=${dxy})`, score: 15, weight: 0.45 });
    } else if (dxy >= DXY_STRONG) {
      drivers.push({ label: `moderate USD strength (${dxySource}=${dxy})`, score: 30, weight: 0.45 });
    } else if (dxy <= DXY_WEAK) {
      drivers.push({ label: `weak USD (${dxySource}=${dxy})`, score: 75, weight: 0.45 });
    } else {
      drivers.push({ label: `neutral USD (${dxySource}=${dxy})`, score: 50, weight: 0.45 });
    }

    // Driver 2: Real yields / 10Y Treasury (weight: 0.35)
    if (yield10Y !== undefined && yield10Y > 0) {
      if (yield10Y >= YIELD_RISING) {
        drivers.push({ label: `high 10Y yield (${yield10Y}%)`, score: 20, weight: 0.35 });
      } else if (yield10Y <= YIELD_FALLING) {
        drivers.push({ label: `low 10Y yield (${yield10Y}%)`, score: 75, weight: 0.35 });
      } else {
        drivers.push({ label: `moderate 10Y yield (${yield10Y}%)`, score: 50, weight: 0.35 });
      }
    } else {
      // No yield data — redistribute weight to DXY
      drivers[0].weight += 0.20;
    }

    // Driver 3: VIX / safe-haven demand (weight: 0.20, or redistributed)
    if (vix !== undefined && vix > 0) {
      if (vix >= VIX_FEAR) {
        drivers.push({ label: `elevated fear (VIX=${vix.toFixed(0)})`, score: 70, weight: 0.20 });
      } else {
        drivers.push({ label: `calm markets (VIX=${vix.toFixed(0)})`, score: 50, weight: 0.20 });
      }
    } else {
      // No VIX data — redistribute to DXY
      drivers[0].weight += 0.15;
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

    const hasFullData = yield10Y !== undefined && vix !== undefined;
    const confidence = hasFullData ? 0.55 : 0.35;

    return {
      signalClass,
      score: weightedScore,
      confidence,
      reason: `${sym}: ${parts.join('; ')} → composite=${weightedScore}`,
    };
  }
}
