/**
 * StopGuardianService — directive-based trailing stop management.
 *
 * Monitors open MT5 positions and adjusts stop-loss levels using
 * directive consensus rather than simple price-distance rules.
 *
 * Talks directly to the MT5 bridge for raw position data (ticket, sl, tp).
 */

import { Injectable, Logger } from '@nestjs/common';
import { TradingStrategyService } from '../trading/trading-strategy.service';
import { DirectivesService } from '../directives/directives.service';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import { NotificationService } from '../notifications/notifications.service';

interface Mt5RawPosition {
  ticket: number;
  symbol: string;
  type: string;
  volume: number;
  priceOpen: number;
  priceCurrent: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  comment: string;
}

export interface GuardianState {
  enabled: boolean;
  tickIntervalMs: number;
  tickCount: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  lastTickMs: number;
  guardedPositions: GuardedPosition[];
  recentAdjustments: StopAdjustment[];
}

export interface GuardedPosition {
  ticket: number;
  symbol: string;
  strategyId: string;
  strategyName: string;
  side: 'BUY' | 'SELL';
  currentSl: number | null;
  recommendedSl: number | null;
  stopConfidence: number;
  wickFilterPassed: boolean;
  lastEvaluatedAt: string | null;
}

export interface StopAdjustment {
  timestamp: string;
  ticket: number;
  symbol: string;
  oldSl: number | null;
  newSl: number;
  reason: string;
  stopConfidence: number;
}

@Injectable()
export class StopGuardianService {
  private readonly logger = new Logger(StopGuardianService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly bridgeUrl: string;

  state: GuardianState = {
    enabled: false,
    tickIntervalMs: 30_000,
    tickCount: 0,
    lastTickAt: null,
    nextTickAt: null,
    lastTickMs: 0,
    guardedPositions: [],
    recentAdjustments: [],
  };

  constructor(
    private readonly strategyService: TradingStrategyService,
    private readonly directivesService: DirectivesService,
    private readonly mt5Connection: Mt5ConnectionManager,
    private readonly notifications?: NotificationService,
  ) {
    this.bridgeUrl = this.mt5Connection.getUrl();
  }

  // ── Loop Control ──────────────────────────────────────

  start() {
    if (this.state.enabled) {
      return { started: false, message: 'Stop Guardian is already running' };
    }
    this.state.enabled = true;
    this.scheduleNext();
    this.logger.log('Stop Guardian started');
    return { started: true, message: 'Stop Guardian started' };
  }

  stop() {
    this.state.enabled = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.log('Stop Guardian stopped');
    return { stopped: true, message: 'Stop Guardian stopped' };
  }

  private scheduleNext() {
    if (!this.state.enabled) return;
    this.timer = setTimeout(() => {
      this.tick().catch((err) =>
        this.logger.error(`Guardian tick failed: ${(err as Error).message}`),
      );
    }, this.state.tickIntervalMs);
  }

  // ── Bridge Helpers ────────────────────────────────────

  private async bridgeGet<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.bridgeUrl}${path}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  private async bridgePost(path: string, body: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${this.bridgeUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Main Tick ──────────────────────────────────────────

  async tick() {
    if (!this.state.enabled) return [];
    const tickStart = Date.now();
    this.state.tickCount++;
    this.state.lastTickAt = new Date().toISOString();

    const adjustments: StopAdjustment[] = [];

    try {
      // 1. Fetch active auto-mode strategies
      const strategies = await this.strategyService.findAll();
      const autoStrats = strategies.filter(
        (s: any) => s.active && s.mode === 'auto',
      );

      if (autoStrats.length === 0) {
        this.finishTick(tickStart);
        return [];
      }

      // 2. Fetch raw MT5 positions
      const posData = await this.bridgeGet<{ positions: Mt5RawPosition[] }>('/positions');
      const positions = posData?.positions || [];

      if (positions.length === 0) {
        this.state.guardedPositions = [];
        this.finishTick(tickStart);
        return [];
      }

      // 3. Evaluate each auto-strategy position
      const guarded: GuardedPosition[] = [];

      for (const strat of autoStrats) {
        const pos = positions.find(
          (p: Mt5RawPosition) =>
            p.symbol === strat.symbol && (p.comment || '').includes('TCS'),
        );
        if (!pos) continue;

        const side: 'BUY' | 'SELL' = pos.type === 'buy' ? 'BUY' : 'SELL';

        // 4. Load bars
        const candleData = await this.bridgeGet<{ bars: any[] }>(
          `/candles?symbol=${encodeURIComponent(strat.symbol)}&timeframe=5m&limit=30`,
        );
        const bars = candleData?.bars || [];
        if (bars.length < 14) {
          guarded.push(this.makeGuarded(pos, strat, side, null, 0, true));
          continue;
        }

        // 5. Run stop-focused directives
        const resultsMap = await this.directivesService.runAll({
          symbol: strat.symbol,
          bars,
        });

        const atrStop = resultsMap.get('atr-trailing-stop');
        const superTrend = resultsMap.get('supertrend');
        const chandelier = resultsMap.get('chandelier-exit');
        const wickFilter = resultsMap.get('wick-filter');

        // 6. Wick filter check
        const wickPassed = !(wickFilter as any)?.metadata?.isFakeout;
        const wickScore = wickFilter?.score ?? 50;

        if (!wickPassed) {
          guarded.push(
            this.makeGuarded(pos, strat, side, pos.sl, 15, false),
          );
          continue;
        }

        // 7. Weighted confidence
        const scores = [
          atrStop?.score ?? 50,
          superTrend?.score ?? 50,
          chandelier?.score ?? 50,
          wickScore,
        ].filter((s) => s > 0);
        const avgConfidence =
          scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);

        // 8. ATR-based recommended SL
        const atrValue = this.computeAtr(bars);
        const currentPrice = pos.priceCurrent;
        let recommendedSl: number | null = null;

        if (atrValue > 0) {
          const trailDistance = 3 * atrValue;
          if (side === 'BUY') {
            recommendedSl = currentPrice - trailDistance;
            if (pos.sl != null && pos.sl > 0 && recommendedSl < pos.sl)
              recommendedSl = pos.sl;
          } else {
            recommendedSl = currentPrice + trailDistance;
            if (pos.sl != null && pos.sl > 0 && recommendedSl > pos.sl)
              recommendedSl = pos.sl;
          }
        }

        // 9. Execute modification if confident
        const shouldAdjust =
          avgConfidence >= 55 &&
          recommendedSl !== null &&
          Math.abs(recommendedSl - (pos.sl || 0)) > 0.00001;

        if (shouldAdjust) {
          const ok = await this.bridgePost('/order/modify', {
            ticket: pos.ticket,
            sl: recommendedSl,
          });

          if (ok) {
            const entry: StopAdjustment = {
              timestamp: new Date().toISOString(),
              ticket: pos.ticket,
              symbol: strat.symbol,
              oldSl: pos.sl,
              newSl: recommendedSl!,
              reason: `Consensus ${avgConfidence.toFixed(0)}% | ATR=${atrValue.toFixed(5)} | Wick=${wickScore}`,
              stopConfidence: Math.round(avgConfidence),
            };
            adjustments.push(entry);
            this.state.recentAdjustments = [
              entry,
              ...this.state.recentAdjustments,
            ].slice(0, 50);
            this.logger.log(
              `Stop: ${strat.symbol} #${pos.ticket} SL ${pos.sl} → ${recommendedSl} (${avgConfidence.toFixed(0)}%)`,
            );
            // Surface the adjustment — evidence the bot is actively managing
            // stops while the app is running (#721).
            this.notifications?.send({
              title: `🛡️ Stop adjusted — ${strat.symbol}`,
              body: `${side} #${pos.ticket} SL ${pos.sl} → ${recommendedSl!.toFixed(5)} (consensus ${avgConfidence.toFixed(0)}%)`,
              symbol: strat.symbol,
              event: 'stop-adjusted',
              metadata: { ticket: pos.ticket, oldSl: pos.sl, newSl: recommendedSl, side },
            }).catch(() => {});
          }
        }

        guarded.push(
          this.makeGuarded(
            pos,
            strat,
            side,
            recommendedSl,
            Math.round(avgConfidence),
            true,
          ),
        );
      }

      this.state.guardedPositions = guarded;
    } catch (err) {
      this.logger.error(`Guardian tick error: ${(err as Error).message}`);
    }

    this.finishTick(tickStart);
    this.logger.log(
      `Guardian #${this.state.tickCount}: ${adjustments.length} adjusted, ${this.state.guardedPositions.length} guarded`,
    );
    this.scheduleNext();
    return adjustments;
  }

  async runNow() {
    const adjustments = await this.tick();
    return { run: true, adjustments };
  }

  getState(): GuardianState {
    return this.state;
  }

  // ── Private Helpers ────────────────────────────────────

  private finishTick(tickStart: number) {
    this.state.lastTickMs = Date.now() - tickStart;
    this.state.nextTickAt = new Date(
      Date.now() + this.state.tickIntervalMs,
    ).toISOString();
  }

  private makeGuarded(
    pos: Mt5RawPosition,
    strat: any,
    side: 'BUY' | 'SELL',
    recommendedSl: number | null,
    stopConfidence: number,
    wickFilterPassed: boolean,
  ): GuardedPosition {
    return {
      ticket: pos.ticket,
      symbol: strat.symbol,
      strategyId: strat.id,
      strategyName: strat.name,
      side,
      currentSl: pos.sl,
      recommendedSl,
      stopConfidence,
      wickFilterPassed,
      lastEvaluatedAt: new Date().toISOString(),
    };
  }

  private computeAtr(bars: any[]): number {
    const highs = bars.map((b: any) => b.high);
    const lows = bars.map((b: any) => b.low);
    const closes = bars.map((b: any) => b.close);
    const trueRanges: number[] = [];
    for (let i = 1; i < Math.min(15, bars.length); i++) {
      trueRanges.push(
        Math.max(
          highs[i] - lows[i],
          Math.abs(highs[i] - closes[i - 1]),
          Math.abs(lows[i] - closes[i - 1]),
        ),
      );
    }
    return trueRanges.length > 0
      ? trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length
      : 0;
  }
}
