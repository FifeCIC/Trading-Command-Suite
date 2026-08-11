/**
 * DXY Regime Directive — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ===================================================================
 * Detects USD strength/weakness via DXY (US Dollar Index) and
 * adjusts scores based on each symbol's correlation to the dollar.
 *
 * ── Hybrid Scoring ─────────────────────────────────────────
 * BASE (0–100):  Continuous DXY interpolation. DXY 108→0pts, DXY 95→100pts.
 *                Every DXY tick produces a visible score change.
 * BONUS tiers:   Extreme USD events. DXY > 108 (risk-off) → +25.
 *                DXY < 95 (USD collapse) → +25 for inverse symbols.
 * CORRELATION:   INVERSE symbols use base as-is. POSITIVE (USDCAD) flip to 100-base.
 *                MILDLY_INVERSE dampened by 15%.
 * MAX:           125 (100 base + 25 bonus).
 *
 * ── Data Source ──────────────────────────────────────────
 * DXY value passed via DirectiveInput.dxyValue (number).
 * EURUSD proxy fallback when DXY unavailable (EURUSD = 57.6% of DXY basket).
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/** Linear interpolation: map value from [inMin,inMax] to [outMin,outMax], clamped. */
function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

// ── Symbol classification ────────────────────────────────

const INVERSE_SYMBOLS = new Set([
  'XAUUSD', 'XAGUSD', 'XAU', 'XAG',
  'EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD',
  'EUR', 'GBP', 'AUD', 'NZD',
]);

const POSITIVE_SYMBOLS = new Set([
  'USDCAD', 'USDJPY', 'USDCHF', 'USDCNH', 'USDSEK',
]);

const MILDLY_INVERSE_SYMBOLS = new Set([
  'BTCUSD', 'ETHUSD', 'BTC-USD', 'ETH-USD', 'SOLUSD',
  'USOIL', 'UKOIL', 'NATGAS',
  'SPX500', 'TECH100', 'DJI30', 'SPY', 'QQQ', 'US30',
]);

// ── Thresholds ────────────────────────────────────────────

const DXY_STRONG = 108;  // Extreme USD strength — risk-off bonus trigger
const DXY_WEAK = 95;     // Extreme USD weakness — dollar collapse bonus trigger

// ── Directive ─────────────────────────────────────────────

@Injectable()
export class DxyRegimeDirective implements IDirective {
  readonly id = 'dxy-regime';
  readonly name = 'DXY Regime';
  readonly description =
    'Hybrid: continuous DXY base (108→0pts, 95→100pts) + extreme-DXY bonuses. ' +
    'Gold, majors, commodities, and crypto are all correlated to USD strength.';
  readonly priority = 55;
  readonly maxScore = 125;
  readonly minScore = 1; // 100 base + 25 extreme bonus
  readonly minBars = { '1d': 20 };
  readonly version = '2.0.1';
  readonly requiredDataFeeds = ['dxy'];
  readonly readiness = 'beta' as const;
  readonly category = 'structural' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    let dxy = (input as any).dxyValue as number | undefined;
    const eurusd = (input as any).eurusdValue as number | undefined;
    const sym = input.symbol.toUpperCase();

    // ── EURUSD proxy fallback ─────────────────────────────
    let proxyUsed = false;
    if ((dxy === undefined || dxy <= 0) && eurusd !== undefined && eurusd > 0) {
      proxyUsed = true;
      if (eurusd >= 1.15) dxy = 98;
      else if (eurusd >= 1.08) dxy = 103;
      else dxy = 108;
    }

    // ── No DXY data ───────────────────────────────────────
    if (dxy === undefined || dxy <= 0) {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0.10,
        reason: `No DXY or EURUSD proxy data for ${input.symbol}. Connect MT5 (EURUSD always available), Finnhub forex, or a broker with DXY futures.`,
      };
    }

    // ── BASE (continuous, 0–100) ──────────────────────────
    // DXY 108 (extreme strong USD) → base 0
    // DXY 101 (neutral) → base ~54
    // DXY 95 (weak USD) → base 100
    const rawBase = Math.round(mapRange(dxy, DXY_STRONG, DXY_WEAK, 0, 100));

    // Apply correlation direction
    let baseScore: number;
    let dirLabel: string;
    if (INVERSE_SYMBOLS.has(sym)) {
      baseScore = rawBase;
      dirLabel = 'inverse (USD up=symbol down)';
    } else if (POSITIVE_SYMBOLS.has(sym)) {
      baseScore = 100 - rawBase;
      dirLabel = 'positive (pair rises with USD)';
    } else if (MILDLY_INVERSE_SYMBOLS.has(sym)) {
      baseScore = Math.round(rawBase * 0.85 + 7.5);
      dirLabel = 'mild inverse (risk-sentiment)';
    } else {
      baseScore = 50;
      dirLabel = 'unknown symbol — neutral';
    }

    // ── BONUS (threshold-gated, rare events) ───────────────
    let bonusScore = 0;
    let bonusLabel = '';
    if (dxy >= DXY_STRONG) {
      bonusScore = 25;
      bonusLabel = 'extreme USD strength — risk-off shock';
    } else if (dxy <= DXY_WEAK) {
      bonusScore = 25;
      bonusLabel = 'USD collapse — dollar debasement';
    }

    // ── Signal classification ─────────────────────────────
    const totalScore = Math.min(this.maxScore, baseScore + bonusScore);
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (INVERSE_SYMBOLS.has(sym) || MILDLY_INVERSE_SYMBOLS.has(sym)) {
      signalClass = totalScore >= 65 ? 'bullish' : totalScore <= 35 ? 'bearish' : 'neutral';
    } else if (POSITIVE_SYMBOLS.has(sym)) {
      signalClass = totalScore >= 65 ? 'bullish' : totalScore <= 35 ? 'bearish' : 'neutral';
    } else {
      signalClass = 'neutral';
    }

    const proxyNote = proxyUsed ? ' (EURUSD proxy)' : '';

    return {
      signalClass,
      score: totalScore,
      confidence: proxyUsed ? 0.35 : 0.55,
      reason: `${sym} ${dirLabel}: DXY≈${dxy}${proxyNote} → base=${baseScore}${bonusScore > 0 ? ` + ${bonusScore} bonus (${bonusLabel})` : ''} = ${totalScore}`,
      metadata: { baseScore, bonusScore, bonusLabel: bonusLabel || null },
    };
  }
}
