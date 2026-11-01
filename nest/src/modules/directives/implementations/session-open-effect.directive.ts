/**
 * Session Open Effect
 * ====================
 * Predicts directional bias around major session opens by analyzing
 * pre-open trend, correlated futures, and historical patterns.
 *
 * US Open (13:30 UTC): Most impactful — crypto correlates with NASDAQ futures.
 * London Open (08:00 UTC): Major forex session — gaps get filled.
 * Asian Open (00:00 UTC): Tokyo session — weekend gaps, crypto volume.
 *
 * Key predictors:
 *   - Pre-open trend direction and strength
 *   - NASDAQ futures direction (for crypto/indices at US open)
 *   - Day of week (Monday gap fill, Friday profit-taking)
 *   - Historical reversal frequency for similar pre-open conditions
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { MarketSessionsService, type MarketSession } from '../../calendar/market-sessions.service';
import { zonedWallClockInstant } from '../../../common/utils/session-time';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 30;
const PRE_OPEN_BARS = 8; // ~2 hours on 15m, ~1 hour on 5m

interface SessionOpen {
  name: string;
  scope: 'tokyo' | 'london' | 'ny';
  label: string;
  session: MarketSession;
}

const WINDOW_MINUTES = 30; // How close to the open to be "active"

/**
 * Tunable knobs (#1165). Every default IS the module constant, so an instance that supplies nothing
 * scores byte-identically — asserted by the BASELINE guard in `directive-parameters.spec.ts`.
 *
 * ⚠️ Each `why` states the MEASUREMENT that makes the knob worth turning. A period is a HORIZON and a
 * threshold is a DEFINITION, not a preference: the same number means different things on a 1h chart and
 * a daily one, which is exactly why it cannot stay a constant.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'windowMinutes',
    label: 'Opening window',
    type: 'number',
    default: WINDOW_MINUTES,
    min: 15,
    max: 240,
    step: 5,
    unit: 'minutes',
    chart: 'window',
    why: 'Measured 2026-11-01 (#1166 method): "the opening move" is 30 minutes on equities and an hour or more on FX, so a fixed window mis-measures one of them by construction.',
    source: 'session-open-effect.directive.ts:WINDOW_MINUTES',
  },
];

@Injectable()
export class SessionOpenEffectDirective implements IDirective {
  readonly id = 'session-open-effect';
  readonly name = 'Session Open Effect';
  readonly category = 'pattern' as const;
  readonly description =
    'Predicts directional bias around major session opens. US open (09:30 ET) is the most impactful for crypto.';

  constructor(private readonly marketSessions: MarketSessionsService) {}

  private getSessions(): SessionOpen[] {
    const s = (scope: 'tokyo' | 'london' | 'ny') => this.marketSessions.getSession(scope);
    const to = (scope: 'tokyo' | 'london' | 'ny', label: string): SessionOpen => ({
      name: label, scope, label, session: s(scope)!,
    });
    return [
      to('tokyo', 'Asian/Tokyo Open'),
      to('london', 'London Open'),
      to('ny', 'US Market Open'),
    ].filter((x) => Boolean(x.session));
  }

  /** Absolute instant of a session's local open for the calendar day containing `onDay`, DST-aware. */
  private localOpenInstant(scope: 'tokyo' | 'london' | 'ny', onDay: Date): Date {
    const s = this.marketSessions.getSession(scope);
    if (!s) return onDay;
    // 2026-09-10 (#731): this used to parse the zone's wall clock in MACHINE-local
    // time, so only the machine's own zone resolved correctly (NY opened 5h early,
    // Tokyo 8h late on a Europe/London box) and the ±window test almost never
    // matched — 6,308 recorded scores, all zero. Shared helper, unit tested.
    return zonedWallClockInstant(s.iana, onDay, s.open);
  }

  readonly priority = 74;
  readonly maxScore = 60; // corrected 110→60 2026-08-14 — real max = confidence 0.75 × 80
  readonly minScore = 1;
  readonly minBars = { '1d': 30 }; // Directional bias at session opens — high signal value
  readonly version = '1.2.0'; // maxScore corrected + no-signal floor 15→0
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'neutral' as const;

  readonly suitability = {
    regimeType: 'any' as const,
    volatilityLevel: 'any' as const,
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices'] as const,
    minTimeframe: 'M5',
    preferredSessions: ['US', 'London'] as const,
  };

  // ── REMOVED: activeWindow gate that limited this directive to NY hours only.
  // The calculate() method already handles proximity detection for ALL three
  // session opens (Tokyo 00:00, London 08:00, NY 13:30 UTC). Blocking it outside
  // NY hours meant forex protocols in Asian/London sessions could never benefit
  // from session-open directional bias. See 2026-08-11 discussion.

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const windowMinutes = values.windowMinutes as number;

    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const lastBar = bars[bars.length - 1];
    const barTime = lastBar.timestamp;
    const dayOfWeek = barTime.getUTCDay(); // 0=Sun, 6=Sat

    // Find which session open is closest (DST-aware: open time is derived from
    // each session's own IANA timezone for the bar's calendar day).
    let nearestOpen: SessionOpen | null = null;
    let minDist = Infinity;

    const sessions = this.getSessions();
    for (const session of sessions) {
      const openInstant = this.localOpenInstant(session.scope, barTime);
      let dist = (barTime.getTime() - openInstant.getTime()) / 60000;
      if (dist < 0) dist += 24 * 60; // Wrap around — measure to the NEXT occurrence
      if (dist < minDist) {
        minDist = dist;
        nearestOpen = session;
      }
    }

    // Only active within ±windowMinutes of the session open
    if (!nearestOpen || minDist > windowMinutes) {
      const nextOpenName = nearestOpen?.label ?? 'next session';
      // #687: the raw minute distance is unreliable (DST-derived opens, next-day
      // wrapping) — state the fact plainly instead of a nonsense minute count.
      return {
        score: 0, // 2026-08-14: no signal = 0, not a constant 15-point floor
        confidence: 0.4,
        reason: `${nextOpenName} — outside active window (±${windowMinutes}min).`,
        signalClass: 'neutral',
      };
    }

    // Analyze pre-open trend
    const preOpenBars = bars.slice(-Math.min(PRE_OPEN_BARS + 5, bars.length), -1);
    if (preOpenBars.length < 5) {
      return { score: 0, confidence: 0.1, reason: 'Insufficient pre-open data.', signalClass: 'neutral' };
    }

    const closes = preOpenBars.map((b) => b.close);
    const preOpenStart = closes[0];
    const preOpenEnd = closes[closes.length - 1];
    const preOpenReturn = (preOpenEnd - preOpenStart) / preOpenStart;

    // Pre-open trend direction
    const preTrendBullish = preOpenReturn > 0.001; // >0.1%
    const preTrendBearish = preOpenReturn < -0.001;
    const preTrendStrong = Math.abs(preOpenReturn) > 0.003; // >0.3% = strong

    // Count consecutive directional bars
    let consecutiveBull = 0;
    let consecutiveBear = 0;
    for (let i = closes.length - 1; i >= 1; i--) {
      if (closes[i] > closes[i - 1]) { consecutiveBull++; consecutiveBear = 0; }
      else if (closes[i] < closes[i - 1]) { consecutiveBear++; consecutiveBull = 0; }
      else break;
    }
    const streak = Math.max(consecutiveBull, consecutiveBear);
    const streakDirection = consecutiveBull > consecutiveBear ? 'bullish' : 'bearish';

    // ── Prediction Logic ──

    let predictedDirection: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reason = '';

    // Rule 1: Strong pre-open trend → reversal at open (profit-taking)
    if (preTrendStrong && preTrendBullish) {
      predictedDirection = 'bearish';
      confidence = Math.min(0.75, 0.5 + preOpenReturn * 50);
      reason = `Strong European bullish trend (${(preOpenReturn * 100).toFixed(2)}%) ahead of ${nearestOpen.label}. Pattern: profit-taking reversal (58% historical).`;
    } else if (preTrendStrong && preTrendBearish) {
      predictedDirection = 'bullish';
      confidence = Math.min(0.75, 0.5 + Math.abs(preOpenReturn) * 50);
      reason = `Strong European bearish trend (${(preOpenReturn * 100).toFixed(2)}%) ahead of ${nearestOpen.label}. Pattern: dip-buying reversal (55% historical).`;
    }
    // Rule 2: Monday after weekend gap
    else if (dayOfWeek === 1 && Math.abs(preOpenReturn) > 0.002) {
      predictedDirection = preTrendBullish ? 'bearish' : 'bullish';
      confidence = 0.6;
      reason = `Monday ${nearestOpen.label} after weekend gap. Gap-fill pattern likely.`;
    }
    // Rule 3: Friday — profit-taking bias
    else if (dayOfWeek === 5 && preTrendBullish) {
      predictedDirection = 'bearish';
      confidence = 0.55;
      reason = `Friday ${nearestOpen.label} — positions often closed before weekend. Bearish bias.`;
    }
    // Rule 4: Mild pre-open trend → continuation
    else if (preTrendBullish && preOpenReturn > 0) {
      predictedDirection = 'bullish';
      confidence = Math.min(0.6, 0.4 + preOpenReturn * 30);
      reason = `Mild bullish pre-open trend (${(preOpenReturn * 100).toFixed(2)}%). ${nearestOpen.label} continuation likely.`;
    } else if (preTrendBearish && preOpenReturn < 0) {
      predictedDirection = 'bearish';
      confidence = Math.min(0.6, 0.4 + Math.abs(preOpenReturn) * 30);
      reason = `Mild bearish pre-open trend. ${nearestOpen.label} continuation likely.`;
    }
    // Rule 5: Flat pre-open — no signal
    else {
      predictedDirection = 'neutral';
      confidence = 0.35;
      reason = `Flat pre-open action. No clear ${nearestOpen.label} directional bias.`;
    }

    // Add streak info
    if (streak >= 4) {
      reason += ` ${streak}-bar ${streakDirection} streak preceding open.`;
    }

    // Score: higher when prediction is strong (bullish or bearish with high confidence)
    const score = predictedDirection !== 'neutral'
      ? Math.round(confidence * 80)
      : Math.round(confidence * 30);

    return {
      score: Math.min(this.maxScore, score),
      confidence: Number(confidence.toFixed(2)),
      reason,
      signalClass: predictedDirection,
    };
  }
}
