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
 * The broker cap is `MT5_MAX_OPEN_POSITIONS=5` — now the `risk.maxOpenPositions` setting — and it
 * is broker-wide. 11 active `auto` bots compete for those 5 slots. Nothing was freeing them,
 * because **no time-based exit existed anywhere in the codebase**: `maxHoldDuration` was declared
 * on a strategy interface with a default of `'30d'`, but it was never READ. The only exits were
 * price-based (SL/TP via StopGuardianService) or manual.
 *
 * ⚠️ That interface (`nest/src/modules/strategies/trading-strategy.interface.ts`) was DELETED on
 * 2026-09-17 — it described a strategy model that never existed (`account: alpaca|trading212|ibkr`,
 * `automation.schedule`) and was imported by nothing. Its `maxHoldDuration` default and four
 * hand-copied risk caps were the last trace of the promise, which is why the defect above was
 * invisible: the field LOOKED declared. The lesson is carried by `risk-profile-rules.ts` now, which
 * fails the build when a declared constant has no reader or no setting.
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
import { PrismaService } from '../../database/prisma.service';
import { CLOSE_REASONS } from '../../common/trading/close-reason';
import { classifyMt5Comment } from '../providers/mt5-comment.util';

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
  /**
   * Positions that could NOT be evaluated, with the reason. ⚠️ Deliberately SEPARATE from
   * `candidates`: before this existed, "no position is over its limit" and "I could not work
   * out whose position this is" produced identical state — so a completely dead attribution
   * path was indistinguishable from a healthy, idle service.
   */
  skipped: TimeStopSkip[];
  /**
   * Counts from the last evaluation.
   *
   * ⚠️ Without this, "0 candidates" cannot be distinguished from "0 positions were read" — the
   * happy path had exactly the blind spot that `skipped` was added to fix on the failure path.
   * `positionsSeen` is the denominator: if it is 0 while the broker reports open positions, the
   * read is what is broken, not the limits.
   */
  lastSummary: {
    positionsSeen: number;
    attributed: number;
    withinLimit: number;
    noLimitConfigured: number;
    skipped: number;
    candidates: number;
  } | null;
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

/**
 * HISTORICAL — this service's retired second parser (#949). Kept because it explains WHY the
 * canonical `classifyMt5Comment()` must accept the real `TCS <name>` form AND the legacy colon form.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS ONCE EXISTED SEPARATELY FROM `attributeToStrategy` (measured 2026-09-17) — and why
 * keeping it separate was the wrong answer.
 * ─────────────────────────────────────────────────────────────────────────────────────
 *
 * The docs said the comment convention was `TCS:<protocol>:<strategy>`, and this service
 * read exactly that:
 *
 *     /TCS:([^:]+):([^\s]+)/
 *
 * **That regex matched ZERO of the 76 real comments in the database.** Measured:
 *
 *     brokerComment LIKE 'TCS:%'   ->  0
 *     brokerComment LIKE 'TCS %'   -> 59 of 76
 *     examples: 'TCS Gold Day-Trade M15', 'TCS Sydney AUDUSD Session | 65%'
 *
 * So the writer emits `TCS <strategy NAME>`, and the reader was waiting for a
 * colon-delimited form that nothing has ever produced. Every position therefore fell
 * through to symbol-only matching, and every symbol traded by more than one bot was
 * silently skipped — including XAUUSD, which has 4 bots.
 *
 * Two independent reasons that stayed invisible for so long, both worth naming:
 *   1. The integration test fed the DOCUMENTED format (`TCS:xau-speed-m5:a`), so it passed
 *      while the production path was dead. A fixture that does not match reality proves
 *      only that the mock agrees with itself (see `development-philosophy` §3).
 *   2. A skip was a bare `continue` + a log line, so "could not tell whose position this
 *      is" produced the SAME state as "nothing is over its limit". No surface, no defect.
 *
 * `magic` is not an alternative key: the bridge hardcodes `magic: 234000`
 * (`mt5_bridge_v2.py` /order) and ALL 5 live positions report 234000. The comment is the
 * only per-bot identity a position carries.
 *
 * ⚠️ RETIRED 2026-09-22 (#949). Parsing moved to `providers/mt5-comment.util.ts` —
 * `classifyMt5Comment()`. One parser, one grouping key; this block is documentation only.
 */

/** A position that could NOT be evaluated, and why. */
export interface TimeStopSkip {
  ticket: number;
  symbol: string;
  reason: string;
  comment: string | null;
  hoursHeld: number | null;
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
    skipped: [],
    lastSummary: null,
    closedCount: 0,
    recentCloses: [],
    lastError: null,
  };

  constructor(
    private readonly mt5Connection: Mt5ConnectionManager,
    private readonly strategyService: TradingStrategyService,
    // ⚠️ Added 2026-09-18. The service used to keep its close history ONLY in memory, so every
    // restart erased the record of which positions it had closed and why. Measured consequence:
    // an investigation into 15-of-16 trades closing at 3–18% of their SL/TP distance could not
    // rule this service IN or OUT, because its evidence for the previous hours was already gone.
    // Writing `closeReason` onto the trade row makes the record durable. See close-reason.ts.
    private readonly prisma: PrismaService,
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
    /** Counters — see `lastSummary`. These make a zero unambiguous. */
    let attributed = 0;
    let withinLimit = 0;
    let noLimit = 0;
    const setSummary = (candidateCount: number, skipCount: number) => {
      this.state.lastSummary = {
        positionsSeen: positions.length,
        attributed,
        withinLimit,
        noLimitConfigured: noLimit,
        skipped: skipCount,
        candidates: candidateCount,
      };
    };
    if (!positions.length) {
      this.state.candidates = [];
      this.state.skipped = [];
      setSummary(0, 0);
      return;
    }

    const candidates: TimedStopCandidate[] = [];
    /**
     * ⚠️ A position we could not evaluate is NOT the same as a position inside its limit.
     * `within_limit` is deliberately NOT recorded — that is normal operation, and mixing it
     * in would bury the genuine failures under noise.
     */
    const skipped: TimeStopSkip[] = [];
    const noteSkip = (p: any, symbol: string, reason: string, hoursHeld: number | null) => {
      skipped.push({
        ticket: Number(p?.ticket),
        symbol,
        reason,
        comment: p?.comment != null ? String(p.comment) : null,
        hoursHeld: hoursHeld === null ? null : Math.round(hoursHeld * 10) / 10,
      });
    };

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
      const symbol = String(p.symbol ?? '').toUpperCase();
      if (!openedAt || Number.isNaN(openedAt.getTime())) {
        noteSkip(p, symbol, 'no_usable_open_time', null);
        continue;
      }
      if (!symbol) {
        noteSkip(p, symbol, 'no_symbol', null);
        continue;
      }

      const hoursHeld = (Date.now() - openedAt.getTime()) / 3_600_000;

      const attribution = await this.attributeToStrategy(symbol, p.comment);
      if (attribution.reason !== 'ok') {
        noteSkip(p, symbol, attribution.reason, hoursHeld);
        continue;
      }
      attributed++;

      const maxHoldHours = parseMaxHoldHours(attribution.maxHoldDuration);
      if (maxHoldHours === null) {
        // No limit configured → genuinely not our business. Still recorded, so an operator can
        // tell "this bot opted out" apart from "this bot was never matched to the position".
        noLimit++;
        noteSkip(p, symbol, 'no_limit_configured', hoursHeld);
        continue;
      }

      if (hoursHeld <= maxHoldHours) {
        withinLimit++;
        continue; // inside its limit — normal, not a skip
      }

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
    this.state.skipped = skipped;
    setSummary(candidates.length, skipped.length);
    if (!candidates.length) {
      if (skipped.length) {
        // ⚠️ Logged loudly because this is the exact state that hid a completely dead
        // attribution path: zero candidates with every position unattributable is
        // indistinguishable from a healthy, idle service unless the skips are named.
        this.logger.warn(
          `Time-stop: no position is past its limit, but ${skipped.length} could not be evaluated — ` +
            skipped.map((s) => `${s.symbol}#${s.ticket}(${s.reason})`).join(', '),
        );
      } else {
        // Not a warning: this is healthy. Logged so the denominator is always recorded, since
        // "read 6, all inside their limit" and "read 0" are only distinguishable with a count.
        this.logger.log(
          `Time-stop: ${positions.length} position(s) evaluated, ${attributed} attributed, ` +
            `${withinLimit} inside limit, ${noLimit} without a configured limit — nothing to close.`,
        );
      }
      return;
    }

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
        // `origin` stamps `TCS:time-stop` on the broker deal (#916) — belt AND braces with the
        // closeReason write below: the deal survives even when the trade row is not matched yet.
        const result = await (this.mt5Connection as any).closePosition(c.ticket, undefined, 'time-stop');
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

        // ── Record WHY, durably (#865-adjacent, 2026-09-18) ──
        //
        // The in-memory entry above dies with the process. The trade row does not.
        //
        // ⚠️ Written onto the TRADE, not the position, because that is what a reader asks about
        // ("why did this trade close?") and what survives the position row being removed. The
        // sync's `finalizeClosedPosition()` runs on a LATER tick, when the position disappears
        // from the broker snapshot — so it must PRESERVE this value rather than overwrite it. It
        // does; see position-sync.service.ts.
        //
        // `updateMany` + a brokerTicket match, so it is a no-op when the trade row does not exist
        // yet (the sync may not have created it) and never throws on 0 rows.
        await this.prisma.trade
          .updateMany({
            where: { brokerTicket: String(c.ticket), status: 'open' },
            data: {
              closeReason: CLOSE_REASONS.SYSTEM_TIME_STOP,
              // #949 — WHAT it belonged to, not just why it closed. Without this the close path
              // writes `closeReason` but not `strategy`, so the Strategy Comparison page and the
              // bot rating (#894) have nothing to read for every time-stop exit.
              // `strategyName` is resolved by `attributeToStrategy()` above — including the
              // symbol-only case, where it is still the ONE strategy that trades this symbol.
              ...(c.strategyName ? { strategy: c.strategyName } : {}),
            },
          })
          .catch((err: any) => {
            // A missing attribution must not abort a close loop — the position IS closed, and
            // losing the reason is bad but re-opening is worse. Log it loudly instead.
            this.logger.warn(
              `Time-stop closed ${c.symbol}#${c.ticket} but could not record closeReason: ${err?.message ?? err}`,
            );
          });

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
  ): Promise<{
    strategyId: string | null;
    strategyName: string | null;
    maxHoldDuration: unknown;
    /** Why attribution succeeded or failed — surfaced in `state.skipped`. */
    reason: string;
  }> {
    const parsed = classifyMt5Comment(comment);
    if (parsed.kind === 'manual') {
      // A human trade. Applying a bot's hold limit to it could close a position nobody
      // configured us to manage.
      return { strategyId: null, strategyName: null, maxHoldDuration: null, reason: 'manual_trade' };
    }
    const wanted = parsed.name ?? null;

    let strategies: any[] = [];
    try {
      strategies = (await (this.strategyService as any).findAll?.()) ?? [];
    } catch {
      return { strategyId: null, strategyName: null, maxHoldDuration: null, reason: 'strategy_lookup_failed' };
    }
    if (!Array.isArray(strategies) || !strategies.length) {
      return { strategyId: null, strategyName: null, maxHoldDuration: null, reason: 'no_strategies_loaded' };
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

    const ok = (s: any) => ({
      strategyId: s.id ?? null,
      strategyName: s.name ?? null,
      maxHoldDuration: holdOf(s),
      reason: 'ok',
    });

    if (wanted) {
      // Try id, then slug, then NAME. ⚠️ Name is the one that works in production: the order
      // comment carries the strategy's display name (`TCS Gold Day-Trade M15`), and `magic`
      // is the shared constant 234000, so it cannot disambiguate anything.
      const byKey = matching.filter((s) => s.id === wanted || s.slug === wanted);
      const exact = byKey.length
        ? byKey
        : matching.filter(
            (s) => String(s?.name ?? '').trim().toLowerCase() === wanted.trim().toLowerCase(),
          );

      if (exact.length === 1) return ok(exact[0]);
      if (exact.length > 1) {
        this.logger.warn(
          `Time-stop: order comment '${wanted}' matches ${exact.length} strategies for ${symbol} — ` +
            `skipping rather than guessing which hold limit applies.`,
        );
        return { strategyId: null, strategyName: null, maxHoldDuration: null, reason: 'comment_ambiguous' };
      }
      if (matching.length > 1) {
        this.logger.warn(
          `Time-stop: ${symbol} is traded by ${matching.length} strategies and the order comment ` +
            `'${wanted}' did not match any of them — skipping rather than guessing.`,
        );
        return {
          strategyId: null, strategyName: null, maxHoldDuration: null,
          reason: 'comment_no_match_multi_strategy',
        };
      }
      // A single strategy trades the symbol: the comment naming nothing we know is not a
      // reason to refuse — fall through to the unambiguous symbol match below.
    }

    if (matching.length === 1) return ok(matching[0]);

    if (matching.length > 1) {
      this.logger.warn(
        `Time-stop: ${symbol} is traded by ${matching.length} strategies and the order comment ` +
        `did not disambiguate — skipping rather than guessing which hold limit applies.`,
      );
      return { strategyId: null, strategyName: null, maxHoldDuration: null, reason: 'ambiguous_multi_strategy' };
    }

    return { strategyId: null, strategyName: null, maxHoldDuration: null, reason: 'no_strategy_trades_symbol' };
  }
}
