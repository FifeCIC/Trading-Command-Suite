/**
 * DXY Regime Directive
 * ====================
 * Detects USD strength/weakness via DXY (US Dollar Index) and
 * adjusts scores based on each symbol's correlation to the dollar.
 *
 * ── Correlation Map ──────────────────────────────────────
 * DXY ↑ (USD strengthening):
 *   XAUUSD, XAGUSD  → bearish (gold/silver priced in USD)
 *   EURUSD, GBPUSD, AUDUSD, NZDUSD → bearish (USD strengthens vs majors)
 *   USDCAD, USDJPY  → bullish (USD strengthens — pair rises)
 *   BTCUSD, ETHUSD  → mildly bearish (risk-off, USD strength)
 *   USOIL, UKOIL    → mildly bearish (commodities priced in USD)
 *   US indices (SPX, QQQ, DJI) → mildly bearish (tightening effect)
 *
 * DXY ↓ (USD weakening): inverse of above.
 *
 * ── Data Source ──────────────────────────────────────────
 * DXY value passed via DirectiveInput.dxyValue (number).
 * Feeds from: Finnhub forex rates, Alpha Vantage FX_DAILY,
 *             or MT5 DXY/DX symbol if available.
 *
 * Without real DXY data, falls back to EURUSD inverse proxy
 * (EURUSD is 57.6% of DXY basket — rough approximation).
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

// ── Symbol classification ────────────────────────────────

/** Symbols that INVERSE correlate with DXY (USD up = symbol down) */
const INVERSE_SYMBOLS = new Set([
  'XAUUSD', 'XAGUSD', 'XAU', 'XAG',
  'EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD',
  'EUR', 'GBP', 'AUD', 'NZD',
]);

/** Symbols that POSITIVE correlate with DXY (USD up = symbol up) */
const POSITIVE_SYMBOLS = new Set([
  'USDCAD', 'USDJPY', 'USDCHF', 'USDCNH', 'USDSEK',
]);

/** Symbols that are MILDLY affected (risk-sentiment driven) */
const MILDLY_INVERSE_SYMBOLS = new Set([
  'BTCUSD', 'ETHUSD', 'BTC-USD', 'ETH-USD', 'SOLUSD',
  'USOIL', 'UKOIL', 'NATGAS',
  'SPX500', 'TECH100', 'DJI30', 'SPY', 'QQQ', 'US30',
]);

// ── Thresholds ────────────────────────────────────────────

const DXY_STRONG_THRESHOLD = 105;   // DXY > 105 = strong USD
const DXY_WEAK_THRESHOLD = 101;     // DXY < 101 = weak USD
const DXY_EXTREME_THRESHOLD = 108;  // DXY > 108 = extreme strength (risk-off)

// ── Directive ─────────────────────────────────────────────

@Injectable()
export class DxyRegimeDirective implements IDirective {
  readonly id = 'dxy-regime';
  readonly name = 'DXY Regime';
  readonly description =
    'Dollar strength/weakness regime from DXY index. ' +
    'Gold, majors, commodities, and crypto are all correlated to USD strength.';
  readonly priority = 55; // Higher than VIX — DXY leads everything
  readonly maxScore = 100;
  readonly minBars = { '1d': 20 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    let dxy = (input as any).dxyValue as number | undefined;
    const eurusd = (input as any).eurusdValue as number | undefined;
    const sym = input.symbol.toUpperCase();

    // ── EURUSD proxy fallback ───────────────────────────
    // EURUSD is 57.6% of the DXY basket — strong inverse correlation.
    // MetaQuotes-Demo and some brokers don't offer the DXY futures contract.
    let proxyUsed = false;
    if ((dxy === undefined || dxy <= 0) && eurusd !== undefined && eurusd > 0) {
      proxyUsed = true;
      if (eurusd >= 1.15) {
        dxy = 98;  // Weak USD
      } else if (eurusd >= 1.08) {
        dxy = 103; // Neutral
      } else {
        dxy = 108; // Strong USD
      }
    }

    // ── No DXY data ─────────────────────────────────────
    if (dxy === undefined || dxy <= 0) {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0.10,
        reason: `No DXY or EURUSD proxy data for ${input.symbol}. Connect MT5 (EURUSD is always available), Finnhub forex, or a broker with DXY futures (IC Markets, Pepperstone, Forex.com).`,
      };
    }

    // ── Classify DXY regime ─────────────────────────────
    let regimeDesc: string;
    let baseScore: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';

    if (dxy >= DXY_EXTREME_THRESHOLD) {
      regimeDesc = `extreme USD strength${proxyUsed ? ' (EURUSD proxy)' : ''} (DXY≈${dxy}) — risk-off`;
      baseScore = 15;
      signalClass = 'bearish';
    } else if (dxy >= DXY_STRONG_THRESHOLD) {
      regimeDesc = `strong USD${proxyUsed ? ' (EURUSD proxy)' : ''} (DXY≈${dxy})`;
      baseScore = 30;
      signalClass = 'bearish';
    } else if (dxy <= DXY_WEAK_THRESHOLD) {
      regimeDesc = `weak USD${proxyUsed ? ' (EURUSD proxy)' : ''} (DXY≈${dxy})`;
      baseScore = 70;
      signalClass = 'bullish';
    } else {
      regimeDesc = `neutral USD${proxyUsed ? ' (EURUSD proxy)' : ''} (DXY≈${dxy})`;
      baseScore = 50;
      signalClass = 'neutral';
    }

    // ── Apply correlation direction ─────────────────────
    let score: number;
    let dirLabel: string;
    let finalSignal: 'bullish' | 'bearish' | 'neutral';

    if (INVERSE_SYMBOLS.has(sym)) {
      // USD strong → bearish for gold/majors
      score = baseScore;
      dirLabel = 'inverse correlation';
      finalSignal = signalClass === 'bearish' ? 'bearish' : signalClass === 'bullish' ? 'bullish' : 'neutral';
    } else if (POSITIVE_SYMBOLS.has(sym)) {
      // USD strong → bullish for USDCAD/USDJPY
      score = 100 - baseScore; // Flip: if DXY is 85 (strong), baseScore=15 → score=85 for USDCAD
      dirLabel = 'positive correlation (pair rises with USD)';
      finalSignal = signalClass === 'bearish' ? 'bullish' : signalClass === 'bullish' ? 'bearish' : 'neutral';
    } else if (MILDLY_INVERSE_SYMBOLS.has(sym)) {
      // Mild inverse — dampened effect
      score = baseScore + 10; // Less extreme than pure inverse
      if (score > 90) score = 90;
      if (score < 20) score = 20;
      dirLabel = 'mild inverse (risk-sentiment driven)';
      finalSignal = signalClass === 'bearish' ? 'bearish' : signalClass === 'bullish' ? 'bullish' : 'neutral';
    } else {
      // Unknown symbol — neutral
      score = 50;
      dirLabel = 'no known DXY correlation';
      finalSignal = 'neutral';
    }

    const confidence = dxy ? 0.55 : 0.10;

    return {
      signalClass: finalSignal,
      score,
      confidence,
      reason: `${regimeDesc}, ${sym}: ${dirLabel} → score=${score}/100`,
    };
  }
}
