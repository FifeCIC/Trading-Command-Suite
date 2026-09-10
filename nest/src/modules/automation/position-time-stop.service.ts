/**
 * PositionTimeStopService — closes positions held longer than their strategy allows.
 *
 * WHY THIS EXISTS (#773)
 * ======================
 * The pipeline is not starved of signals. It is starved of POSITION SLOTS.
 *
 * Measured live 2026-09-10:
 *
 *     633 decisions in 24h  ->  2 executed
 *     BLOCKED  Max open positions (5) reached — 5 currently open   28 times
 *     Blocked signals reached composite 81 and 82
 *
 * The broker cap is `MT5_MAX_OPEN_POSITIONS=5` and it is broker-wide. 11 active `auto`
 * bots compete for those 5 slots. Nothing was freeing them, because **no time-based exit
 * existed anywhere in the codebase**: `maxHoldDuration` is declared on the strategy
 * interface (`trading-strategy.interface.ts`) with a default of `'30d'`, but it is never
 * READ. The only exits were price-based (SL/TP via StopGuardianService) or manual.
 *
 * The consequence is a one-way ratchet: slots fill and stay filled. A protocol named
 * "Scalp (5s–30s)" was observed holding for weeks, because a position with no time-stop
 * only closes when price happens to reach SL or TP.
 *
 * WHY A TIME-STOP AND NOT A BIGGER CAP
 * ------------------------------------
 * Raising the cap enlarges exposure on correlated FX/gold and converts a *volume* problem
 * into a *risk* problem (#773 "do not simply raise the number"). A time-stop does the
 * opposite: it bounds how long capital can sit in a position that is not working, so it
 * FREES slots while REDUCING exposure. That is why it is the first lever.
 *
 * DESIGN NOTES
 * ------------
 * - Opt-in per strategy via `maxHoldDuration`. `'unlimited'` (and unset) means no
 *   time-stop, so existing behaviour is preserved and nothing closes by surprise.
 * - Closes at MARKET. A time-stop is an admission the thesis did not resolve; refusing to
 *   pay the spread would keep the slot occupied, which is the bug being fixed.
 * - Never closes a position it cannot attribute to a strategy by SYMBOL. Closing the wrong
 *   ticket is worse than leaving a slot occupied, so an ambiguous match is skipped and
 *   logged rather than guessed.
 * - Dry-run by default (`POSITION_TIMESTOP_DRY_RUN=1`). A service that closes real
 *   positions should be observable before it is armed.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import { TradingStrategyService } from '../trading/trading-strategy.service';

/** A position the bridge reports, plus the hold time we computed for it. */
export interface TimedStopCandidate {
  ticket: number;
  symbol: string;
  strategyId: string | null;
  strategyName: string | null;
  side: 'BUY' | 'SELL' | 'UNKNOWN';
  hoursHeld: number;
  maxHoldHours: number | null;
  overByHours: number;
  profit: number;
}

export interface TimeStopState {
  enabled: boolean;
  /** true => report only, never send a close. Logged loudly on every tick. */
  dryRun: boolean;
  tickIntervalMs: number;
  tickCount: number;
  lastTickAt: string | null;
  lastTickMs: number;
  /** Positions currently past their limit. */
  candidates: TimedStopCandidate[];
  /** Positions actually closed since start. */
  closedCount: number;
  recentCloses: Array<{ timestamp: string; ticket: number; symbol: string; hoursHeld: number; profit: number }>;
  lastError: string | null;
}

/**
 * Parse a strategy `maxHoldDuration` into hours.
 *
 * Accepts the documented formats (`'7d'`, `'30d'`, `'unlimited'`) plus `h`/`m` for
 * sub-day limits, because a scalp protocol needs hours not days. Returns null for
 * "no limit" so callers cannot accidentally treat it as 0 (which would close everything).
 */
export function parseMaxHoldHours(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value || value === 'unlimited' || value === 'none' || value === 'off') return null;

  const match = /^(\d+(?:\.\d+)?)\s*([mhdw]?)$/.exec(value);
  if (!match) return null; // unparseable → treat as no limit, never as zero

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  switch (match[2] || 'h') {
    case 'm': return amount / 60;
    case 'h': return amount;
    case 'd': return amount * 24;
    case 'w': return amount * 24 * 7;
    default: return null;
  }
}

@Injectable()
export class PositionTimeStopService {
  private readonly logger = new Logger(PositionTimeStopService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  state: TimeStopState = {
    enabled: false,
    dryRun: process.env.POSITION_TIMESTOP_DRY_RUN !== '0',
    tickIntervalMs: 5 * 60_000, // 5 min — hold times are hours, so this is ample
    tickCount: 0,
    lastTickAt: null,
    lastTickMs: 0,
    candidates: [],
    closedCount: 0,
    recentCloses: [],
    lastError: null,
  };

  constructor(
    private readonly mt5Connection: Mt5ConnectionManager,
    private readonly strategyService: TradingStrategyService,
  ) {}

  // ── Loop control (mirrors StopGuardianService so operators see one pattern) ──

  start() {
    if (this.state.enabled) {
      return { started: false, message: 'Position time-stop is already running' };
    }
    this.state.enabled = true;
    this.scheduleNext();
    this.logger.log(
      `Position time-stop started — ${this.state.dryRun ? 'DRY RUN (no closes will be sent)' : 'LIVE'}`,
    );
    if (this.state.dryRun) {
      this.logger.warn(
        'Position time-stop is in DRY RUN. Set POSITION_TIMESTOP_DRY_RUN=0 to arm it.',
      );
    }
    return { started: true, message: `Position time-stop started (dryRun=${this.state.dryRun})` };
  }

  stop() {
    this.state.enabled = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.log('Position time-stop stopped');
    return { stopped: true, message: 'Position time-stop stopped' };
  }

  private scheduleNext() {
    if (!this.state.enabled) return;
    this.timer = setTimeout(() => {
      this.tick().catch((err) =>
        this.logger.error(`Time-stop tick failed: ${(err as Error).message}`),
      );
    }, this.state.tickIntervalMs);
  }

  /** Run one evaluation now (used by tests and by the manual trigger endpoint). */
  async tick(): Promise<TimeStopState> {
    if (this.ticking) return this.state; // never overlap — a close is a slow call
    this.ticking = true;
    const started = Date.now();
    try {
      await this.evaluate();
    } catch (err: any) {
      this.state.lastError = err?.message ?? String(err);
      this.logger.error(`Time-stop evaluation failed: ${this.state.lastError}`);
    } finally {
      this.ticking = false;
      this.state.tickCount++;
      this.state.lastTickAt = new Date().toISOString();
      this.state.lastTickMs = Date.now() - started;
      this.scheduleNext();
    }
    return this.state;
  }

  /**
   * Identify positions past their limit and close them.
   *
   * Ordering matters: the LONGEST-held position is closed first, so if several qualify
   * and a close fails, the slot that frees soonest is the one that has been idle longest.
   */
  private async evaluate() {
    const raw = await (this.mt5Connection as any).getPositions();
    const positions: any[] = Array.isArray(raw) ? raw : (raw?.positions ?? []);
    if (!positions.length) {
      this.state.candidates = [];
      return;
    }

    const candidates: TimedStopCandidate[] = [];

    for (const p of positions) {
      // ⚠️ FIELD NAME: the MT5 bridge returns **`openTime`** (verified against the live
      // `GET :5000/positions` payload: ticket, symbol, type, volume, priceOpen, priceCurrent,
      // sl, tp, profit, swap, contractSize, currencyBase, currencyProfit, openTime, magic,
      // comment). Reading `openedAt` or `time` finds neither, every position is skipped, and
      // the service logs nothing — indistinguishable from "no position is over its limit".
      // `openedAt`/`time` are kept as fallbacks because other adapters use them.
      //
      // ⚠️ PRECEDENCE: `??` binds TIGHTER than `?:`, so the tempting
      //     p.openTime ?? p.openedAt ? new Date(p.openTime) : null
      // parses as `(p.openTime ?? p.openedAt) ? new Date(p.openTime) : null` — it discards
      // the chosen value and rebuilds from one field only. Keep the parens.
      const raw = p.openTime ?? p.openedAt ?? p.time ?? null;
      const openedAt = raw === null ? null : new Date(raw);
      if (!openedAt || Number.isNaN(openedAt.getTime())) continue;

      const symbol = String(p.symbol ?? '').toUpperCase();
      if (!symbol) continue;

      const attribution = await this.attributeToStrategy(symbol, p.comment);
      const maxHoldHours = parseMaxHoldHours(attribution.maxHoldDuration);
      if (maxHoldHours === null) continue; // no limit configured → not our business

      const hoursHeld = (Date.now() - new Date(openedAt).getTime()) / 3_600_000;
      if (hoursHeld <= maxHoldHours) continue;

      candidates.push({
        ticket: Number(p.ticket),
        symbol,
        strategyId: attribution.strategyId,
        strategyName: attribution.strategyName,
        side: p.type === 'buy' ? 'BUY' : p.type === 'sell' ? 'SELL' : 'UNKNOWN',
        hoursHeld: Math.round(hoursHeld * 10) / 10,
        maxHoldHours,
        overByHours: Math.round((hoursHeld - maxHoldHours) * 10) / 10,
        profit: Number(p.profit ?? 0),
      });
    }

    candidates.sort((a, b) => b.hoursHeld - a.hoursHeld);
    this.state.candidates = candidates;
    if (!candidates.length) return;

    this.logger.log(
      `Time-stop: ${candidates.length} position(s) past their max hold — ` +
      candidates.map((c) => `${c.symbol}#${c.ticket} ${c.hoursHeld}h/${c.maxHoldHours}h`).join(', '),
    );

    if (this.state.dryRun) {
      this.logger.warn(
        `Time-stop DRY RUN — would close ${candidates.length} position(s): ` +
        candidates.map((c) => `${c.symbol}#${c.ticket}`).join(', '),
      );
      return;
    }

    for (const c of candidates) {
      try {
        const result = await (this.mt5Connection as any).closePosition(c.ticket);
        if (result?.ok === false) {
          this.logger.warn(`Time-stop close rejected for ${c.symbol}#${c.ticket}: ${result?.error ?? 'unknown'}`);
          continue;
        }
        this.state.closedCount++;
        this.state.recentCloses.unshift({
          timestamp: new Date().toISOString(),
          ticket: c.ticket,
          symbol: c.symbol,
          hoursHeld: c.hoursHeld,
          profit: c.profit,
        });
        if (this.state.recentCloses.length > 50) this.state.recentCloses.length = 50;
        this.logger.log(
          `Time-stop CLOSED ${c.symbol}#${c.ticket} after ${c.hoursHeld}h ` +
          `(limit ${c.maxHoldHours}h, pnl ${c.profit.toFixed(2)}) — slot freed`,
        );
      } catch (err: any) {
        // One failure must not abandon the rest of the batch.
        this.logger.error(`Time-stop close failed for ${c.symbol}#${c.ticket}: ${err?.message ?? err}`);
      }
    }
  }

  /**
   * Resolve which strategy owns a position.
   *
   * Attribution is by SYMBOL, deliberately conservative: the MT5 order comment convention
   * is `TCS:<protocol>:<strategy>` (see `mt5-comment-convention`), but a position may
   * predate a config change or carry an empty comment. If exactly ONE enabled strategy
   * trades the symbol we use it; if several do, we DO NOT GUESS — closing the wrong
   * ticket is worse than leaving a slot occupied, so we return no limit and log it.
   */
  private async attributeToStrategy(
    symbol: string,
    comment?: string,
  ): Promise<{ strategyId: string | null; strategyName: string | null; maxHoldDuration: unknown }> {
    // Prefer an explicit comment match when present — it is ground truth.
    const fromComment = /TCS:([^:]+):([^\s]+)/.exec(String(comment ?? ''));
    const wanted = fromComment?.[2] ?? null;

    let strategies: any[] = [];
    try {
      strategies = (await (this.strategyService as any).findAll?.()) ?? [];
    } catch {
      return { strategyId: null, strategyName: null, maxHoldDuration: null };
    }
    if (!Array.isArray(strategies) || !strategies.length) {
      return { strategyId: null, strategyName: null, maxHoldDuration: null };
    }

    const matching = strategies.filter((s) => {
      // ⚠️ The column is `symbol` (SINGULAR) on `trading_strategy`. Reading `symbols`
      // finds nothing and silently disables the whole time-stop — which is exactly how
      // `maxHoldDuration` came to be declared-but-never-read in the first place.
      const one = s?.symbol ? [String(s.symbol).toUpperCase()] : [];
      const many: string[] = s?.symbols ?? s?.config?.symbols ?? [];
      return [...one, ...many].includes(symbol);
    });

    // ⚠️ `maxHoldDuration` on the TypeScript INTERFACE was never persisted, so it never
    // existed at runtime. The real field is the `maxHoldHours` COLUMN added in #773.
    // A string form is still accepted for forward-compatibility, hence `parseMaxHoldHours`
    // tolerates both — but the DB column (hours, nullable) is the source of truth.
    const holdOf = (s: any): unknown =>
      s?.maxHoldHours ?? s?.tradeManagement?.maxHoldDuration ?? null;

    if (wanted) {
      const exact = matching.filter((s) => s.id === wanted || s.slug === wanted);
      if (exact.length === 1) {
        return { strategyId: exact[0].id ?? null, strategyName: exact[0].name ?? null, maxHoldDuration: holdOf(exact[0]) };
      }
    }

    if (matching.length === 1) {
      return { strategyId: matching[0].id ?? null, strategyName: matching[0].name ?? null, maxHoldDuration: holdOf(matching[0]) };
    }

    if (matching.length > 1) {
      this.logger.warn(
        `Time-stop: ${symbol} is traded by ${matching.length} strategies and the order comment ` +
        `did not disambiguate — skipping rather than guessing which hold limit applies.`,
      );
    }
    return { strategyId: null, strategyName: null, maxHoldDuration: null };
  }
}
