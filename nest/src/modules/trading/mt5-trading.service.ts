import { Injectable, Logger } from '@nestjs/common';
import { TradeRecorderService } from './trade-recorder.service';
import { StopGuardianService } from './stop-guardian.service';
import { CLOSE_REASONS } from '../../common/trading/close-reason';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import { Mt5SymbolRouter } from '../providers/mt5/mt5-symbol-router.service';
import { PrismaService } from '../../database/prisma.service';
import { sanitizeMt5Comment, extractStrategyFromComment } from '../providers/mt5-comment.util';
import { venueForSymbol } from '../calendar/market-patterns';

export interface Mt5Position {
  ticket: number;
  symbol: string;
  type: number | 'buy' | 'sell';
  volume: number;
  price_open: number;
  sl: number;
  tp: number;
  price_current: number;
  profit: number;
  comment: string;
  time: number;
  /**
   * `trade_contract_size` for this position's symbol (from `/positions`).
   * ⚠️ Added 2026-09-18 (#865) — the bridge has always sent it; this mapping dropped it.
   */
  contractSize?: number;
  /**
   * The currency this position's profit is denominated in.
   * ⚠️ Also dropped by this mapping until 2026-09-18. It is the ONLY authoritative source for the
   * profit currency before the bridge exposes it on `/symbol/<SYM>/info`.
   */
  currencyProfit?: string;
}

export interface Mt5Account {
  login: number;
  balance: number;
  equity: number;
  margin: number;
  margin_free: number;
  margin_level: number;
  currency: string;
  /**
   * The account's DECLARED leverage (100 = 1:100).
   *
   * ⚠️ Added 2026-09-18 (#865). The bridge has always sent it; this mapping dropped it. Its
   * absence is why `assessGlobalRiskLimits()` derived leverage as `balance / margin` instead —
   * which is margin UTILISATION (8.62 on this account), not leverage, and inflated every position
   * estimate ~11x. It blocked 78 trades in one day.
   */
  leverage: number;
}

/** Symbol specification from the broker — what a position SIZE actually costs. */
export interface Mt5SymbolInfo {
  name: string;
  description?: string;
  digits: number;
  /** `trade_contract_size`. 100 for gold (oz), 100000 for an FX pair, 1 for an index CFD. */
  contractSize: number;
  volumeMin: number;
  volumeMax: number;
  /**
   * The currency this symbol's profit (and notional) is denominated in.
   * ⚠️ Only present once the bridge is redeployed with the field — see position-margin.ts.
   */
  currencyProfit?: string;
}

@Injectable()
export class Mt5TradingService {
  private readonly logger = new Logger(Mt5TradingService.name);

  constructor(
    private readonly tradeRecorder: TradeRecorderService,
    private readonly stopGuardian: StopGuardianService,
    private readonly prisma: PrismaService,
    private readonly mt5Connection: Mt5ConnectionManager,
    // #903 — optional so tests can construct without it; when absent, a CRYPTO order is REFUSED
    // (fail closed — an unverifiable broker-native name must not reach MT5).
    private readonly symbolRouter?: Mt5SymbolRouter,
  ) {}

  /** Get the bridge URL for a broker (defaults to first active) */
  private get bridgeUrl(): string {
    return this.mt5Connection.getUrl();
  }

  async getAccount(): Promise<Mt5Account | null> {
    try {
      const res = await fetch(`${this.bridgeUrl}/account`);
      if (!res.ok) return null;
      const data = await res.json();
      return {
        login: Number(data.login ?? 0),
        balance: Number(data.balance ?? 0),
        equity: Number(data.equity ?? 0),
        margin: Number(data.margin ?? 0),
        margin_free: Number(data.margin_free ?? data.marginFree ?? 0),
        margin_level: Number(data.margin_level ?? data.marginLevel ?? 0),
        currency: String(data.currency ?? ''),
        // ⚠️ `?? 0`, not `?? 100`. A missing leverage must show up as an unusable account rather
        // than a plausible default that quietly produces a wrong margin estimate.
        leverage: Number(data.leverage ?? 0),
      };
    } catch { return null; }
  }

  async getPositions(): Promise<Mt5Position[]> {
    try {
      const res = await fetch(`${this.bridgeUrl}/positions`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return [];
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data?.positions;
      if (!Array.isArray(rows)) return [];
      return rows.map((p: any) => ({
        ticket: Number(p.ticket),
        symbol: String(p.symbol ?? ''),
        type: p.type,
        volume: Number(p.volume ?? 0),
        price_open: Number(p.price_open ?? p.priceOpen ?? 0),
        sl: Number(p.sl ?? 0),
        tp: Number(p.tp ?? 0),
        price_current: Number(p.price_current ?? p.priceCurrent ?? 0),
        profit: Number(p.profit ?? 0),
        comment: String(p.comment ?? ''),
        time: Number(p.time ?? (p.openTime ? Date.parse(p.openTime) / 1000 : 0)),
        contractSize: p.contractSize != null ? Number(p.contractSize) : undefined,
        currencyProfit: p.currencyProfit != null ? String(p.currencyProfit) : undefined,
      }));
    } catch { return []; }
  }

  /**
   * getSymbolInfo() — the broker's specification for a symbol (#865).
   *
   * ⚠️ `contractSize` is what makes a position SIZE meaningful: 100 for gold (troy oz), 100000 for
   * an FX pair, 1 for an index CFD. Without it, `size × 100_000` is applied to every instrument,
   * which is why a gold entry and a yen-cross entry produced the SAME estimated capital and the
   * per-symbol cap blocked both at the same ratio.
   *
   * Returns null when the symbol is unknown to the broker or the bridge is unreachable — callers
   * must treat that as "cannot evaluate", NOT as a zero-cost position.
   */
  async getSymbolInfo(symbol: string): Promise<Mt5SymbolInfo | null> {
    try {
      const res = await fetch(
        `${this.bridgeUrl}/symbol/${encodeURIComponent(symbol)}/info`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return null;
      const d = await res.json();
      if (d?.error || d?.contractSize == null) return null;
      return {
        name: String(d.name ?? symbol),
        description: d.description != null ? String(d.description) : undefined,
        digits: Number(d.digits ?? 0),
        contractSize: Number(d.contractSize),
        volumeMin: Number(d.volumeMin ?? 0),
        volumeMax: Number(d.volumeMax ?? 0),
        // Absent on the running bridge build; see position-margin.ts for the resolution order.
        currencyProfit: d.currencyProfit != null ? String(d.currencyProfit) : undefined,
      };
    } catch { return null; }
  }

  /**
   * getQuote() — current bid/ask/last for a symbol.
   *
   * Used for two things by the risk estimate (#865): pricing the symbol being traded, and pricing a
   * CURRENCY PAIR for the profit→account conversion. Note the broker quotes one direction only —
   * this account has GBPUSD and GBPJPY, and neither USDGBP nor JPYGBP — so callers must be prepared
   * to invert.
   */
  async getQuote(symbol: string): Promise<{ bid: number; ask: number; last: number } | null> {
    try {
      const res = await fetch(
        `${this.bridgeUrl}/quote?symbol=${encodeURIComponent(symbol)}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return null;
      const d = await res.json();
      if (d?.error || d?.last == null) return null;
      return { bid: Number(d.bid ?? 0), ask: Number(d.ask ?? 0), last: Number(d.last) };
    } catch { return null; }
  }

  /** Fetch candles from MT5 bridge for on-demand scoring (Sprint 2026-07-04) */
  async getCandles(symbol: string, timeframe = '1h', limit = 200): Promise<Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>> {    try {
      const res = await fetch(`${this.bridgeUrl}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${Math.min(limit, 1000)}`);
      if (!res.ok) return [];
      const data = await res.json();
      if (!data?.bars?.length) return [];
      return data.bars.map((b: any) => ({
        timestamp: new Date(b.timestamp),
        open: Number(b.open), high: Number(b.high), low: Number(b.low),
        close: Number(b.close), volume: Number(b.volume),
      }));
    } catch { return []; }
  }

  async placeOrder(params: {
    symbol: string;
    type: 'BUY' | 'SELL';
    volume: number;
    sl?: number;
    tp?: number;
    comment?: string;
    origin?: string;
    clientOrderId?: string;
  }): Promise<{ success: boolean; ticket?: number; price?: number; error?: string; status?: string; filledQuantity?: number }> {
    const side = params.type === 'BUY' ? 'buy' : 'sell';
    const origin = (params.origin || 'user') as 'user' | 'agent' | 'strategy' | 'system';

    // ── CRYPTO ROUTE GUARD (#903, 2026-09-19) ──────────────────────────────────────────────
    //
    // MT5 resolves an order symbol BY NAME with fuzzy matching. The measured hazard: the
    // `symbol_route` row for BTC was `→ binance, brokerId 0, brokerSymbol NULL`, so this method
    // would have handed the bare ticker `BTC` to an MT5 bridge — where it matches
    // `Nasdaq\ETF\BTC` (~$35.86), a different instrument at a different price, and FILLS.
    //
    // Until the crypto execution decision (#903) deliberately chooses an MT5 broker whose
    // contract list actually carries the instrument, a crypto ticker may only travel a route that
    // passes ALL of these: an explicit `symbol_route` row, a brokerSymbol that is NOT the bare
    // ticker, and a target broker that is an active MT5 bridge. Anything less refuses here — the
    // last line before the bridge — and the refusal names exactly what is missing.
    //
    // Non-crypto symbols are untouched: their identity mapping is the established behaviour.
    let orderUrl = this.bridgeUrl;
    let orderSymbol = params.symbol;
    if (venueForSymbol(params.symbol).kind === 'crypto') {
      const route = this.symbolRouter?.resolve(params.symbol);
      const activeBrokerIds = this.mt5Connection.getBrokerIds();
      const brokerSymbol = String(route?.brokerSymbol ?? '');
      const problems: string[] = [];
      if (!route) {
        problems.push('the MT5 symbol router is unavailable, so the broker-native name cannot be verified');
      } else {
        if (route.explicit !== true) {
          problems.push(`no explicit symbol_route row exists for ${params.symbol}`);
        }
        if (!brokerSymbol) {
          problems.push('the symbol_route row carries no brokerSymbol');
        } else if (brokerSymbol.toUpperCase() === params.symbol.toUpperCase()) {
          problems.push(
            `the route's brokerSymbol is the BARE ticker '${brokerSymbol}' — MT5 resolves names ` +
              `fuzzily and '${brokerSymbol}' matches a different instrument (measured: 'BTC' → Nasdaq\\ETF\\BTC, ~$35.86)`,
          );
        }
        if (!activeBrokerIds.includes(route.brokerId)) {
          problems.push(
            `the route targets broker ${route.brokerId}, which is not an active MT5 bridge ` +
              `(active: ${activeBrokerIds.join(', ') || 'none'})`,
          );
        }
      }
      if (problems.length > 0) {
        const error =
          `Refusing to send ${params.symbol} to MT5: ${problems.join('; ')}. ` +
          'A crypto order may only travel an explicit symbol_route whose brokerSymbol is the ' +
          "broker's real symbol (e.g. BTCUSD) on an active MT5 bridge — until the crypto " +
          'execution route is decided and verified, crypto stays score-only (#903).';
        this.logger.warn(error);
        // The audit trail records the attempt — a refusal that never reaches the bridge is
        // still a decision the operator should be able to find.
        this.recordOrder(params.symbol, params.type, params.volume, 'rejected', undefined, undefined, error);
        return { success: false, status: 'rejected', error };
      }
      // Route verified — address THAT broker and send the broker-native name, never the bare
      // ticker. This is the half that makes the guard a routing decision, not just a refusal.
      orderUrl = route.url;
      orderSymbol = brokerSymbol;
    }

    try {
      const body: any = {
        symbol: orderSymbol,
        type: params.type.toLowerCase(),
        volume: params.volume,
      };
      if (params.sl) body.sl = params.sl;
      if (params.tp) body.tp = params.tp;
      if (params.comment) body.comment = sanitizeMt5Comment(params.comment);
      if (params.clientOrderId) body.clientOrderId = params.clientOrderId;

      const res = await fetch(`${orderUrl}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json();

      // ── Order audit: record every bridge order attempt (#477) ──
      const orderStatus = data.status ?? (data.success ? 'filled' : 'rejected');
      const filledQuantity = Number(data.filledVolume ?? data.volume ?? params.volume);
      // ⚠️ #885 — the bridge's refusal diagnostic (reason, TCS code, MT5 retcode, TRADE_RETCODE
      // name, filling mode) now persists with the attempt instead of being dropped.
      this.recordOrder(params.symbol, params.type, params.volume, orderStatus, data.ticket, data.price, data.error, {
        errorCode: data.code ?? null,
        retcode: typeof data.external?.code === 'number' ? data.external.code : null,
        externalName: data.external?.name ?? null,
        fillingMode: data.params?.fillingMode ?? null,
      });

      if (data.success) {
        // Record successful trade with MT5 traceability fields (#446, #616)
        // The 64-bit ticket goes into brokerTicket (string); ticket Int is clamped.
        this.tradeRecorder.record({
          symbol: params.symbol,
          side,
          quantity: filledQuantity,
          entryPrice: data.price,
          provider: 'mt5',
          status: 'open',
          origin,
          strategy: params.comment || undefined,
          brokerTicket: data.ticket != null ? String(data.ticket) : undefined,
          sl: params.sl,
          tp: params.tp,
          magic: 234000, // bridge hardcodes magic=234000 (see mt5_bridge_v2.py /order)
          brokerComment: params.comment,
        });
        // Record initial SL/TP as adjustment (#476)
        if (data.ticket && (params.sl || params.tp)) {
          this.stopGuardian.recordAdjustment({
            tradeTicket: data.ticket as number,
            symbol: params.symbol,
            newSl: params.sl ?? null,
            newTp: params.tp ?? null,
            reason: 'Initial SL/TP set at order placement',
          });
        }
        return { success: true, ticket: data.ticket, price: data.price, status: orderStatus, filledQuantity };
      }
      // Record rejected attempt
      this.tradeRecorder.record({
        symbol: params.symbol,
        side,
        quantity: params.volume,
        provider: 'mt5',
        status: 'rejected',
        origin,
        strategy: params.comment || undefined,
      });
      return { success: false, error: data.error || `HTTP ${res.status}` };
    } catch (err) {
      const errorMsg = (err as Error).message;
      // Network failures are an unknown broker outcome: the request may have
      // reached MT5 before the response was lost. The caller can safely retry
      // with the same clientOrderId.
      this.recordOrder(params.symbol, params.type, params.volume, 'unknown', undefined, undefined, errorMsg);
      return { success: false, error: errorMsg, status: 'unknown' };
    }
  }

  /**
   * Record every order attempt in the order audit table (#477). Fire-and-forget.
   *
   * ⚠️ #885 — `error` was a parameter this method RECEIVED AND DISCARDED (the table had no
   * column for it since #477). The bridge's diagnostic now persists, so "why was this refused"
   * is answerable from the row alone.
   */
  private recordOrder(
    symbol: string,
    type: string,
    quantity: number,
    status: string,
    ticket?: number,
    price?: number,
    error?: string,
    extra?: {
      errorCode?: string | null;
      retcode?: number | null;
      externalName?: string | null;
      fillingMode?: string | null;
    },
  ): void {
    if (!this.prisma.isAvailable) return;
    this.prisma.order.create({
      data: {
        symbol,
        type: type.toLowerCase(),
        side: type === 'BUY' ? 'buy' : 'sell',
        quantity,
        price: price ?? null,
        status,
        provider: 'mt5',
        providerId: ticket ? String(ticket) : null,
        filledAt: status === 'filled' ? new Date() : null,
        error: error ?? null,
        errorCode: extra?.errorCode ?? null,
        retcode: extra?.retcode ?? null,
        externalName: extra?.externalName ?? null,
        fillingMode: extra?.fillingMode ?? null,
      },
    }).catch(() => {}); // fire-and-forget — failures logged silently
  }

  /**
   * closePosition() — STEP 5 of 6 in the trade lifecycle pipeline.
   * BEFORE: placeOrder() opens the trade with strategy tag in MT5 comment field.
   * AFTER:  tradeRecorder.record() persists closed trade to DB with strategy name.
   * NEXT:   Strategy Comparison page (GET /api/trading/strategy-comparison) groups
   *         closed trades WHERE strategy IS NOT NULL for per-strategy P&L/win rate.
   *
   * ⚠️ WARNING: Strategy name is extracted from MT5 position's comment field.
   * Legacy format: "TCS Strategy Name | Score%". Since the shared sanitizer
   * (mt5-comment.util.ts) strips '|', new positions use "TCS Strategy Name Score".
   * Phase 3 moves strategy tracking to the magic number + DB, replacing this
   * fragile comment parsing entirely.
   *
   * ⚠️ #884 — parsing now goes through `extractStrategyFromComment()` in mt5-comment.util.ts,
   * the ONE parser. The name is a GROUPING KEY on the Strategy Comparison page: two conventions
   * (`"TCS X"` vs `"X 119"`) render as two strategies. Do not hand-roll a second parse.
   * @see nest/src/modules/trading/mt5-trading.service.ts placeOrder() line ~98
   */
  async closePosition(ticket: number): Promise<{ success: boolean; error?: string }> {
    try {
      // Snapshot position before closing for audit trail
      const positions = await this.getPositions();
      const pos = positions.find((p) => p.ticket === ticket);

      const res = await fetch(`${this.bridgeUrl}/close/${ticket}`, { method: 'POST' });
      const data = await res.json();
      // MT5 returns multiple success retcodes: 10008 (placed), 10009 (done),
      // 10010 (partial). Treat all as success; anything else is a failure.
      const success = data.success === true || [10008, 10009, 10010].includes(data.retcode);

      // Close the existing lifecycle row rather than inserting a second,
      // opposite-side trade for the same broker position.
      if (success && !data.partial && pos) {
        const posType = String(pos.type) === '0' || (pos as any).type === 'buy' ? 'buy' : 'sell';
        // #884 — canonical parser (mt5-comment.util.ts). Handles both comment eras AND
        // strips the trailing score, so the close path and the record() fallback below write
        // the SAME grouping key.
        const strategyFromComment = extractStrategyFromComment(pos.comment);

        // ⚠️ REALISED P&L, not floating (2026-09-10).
        //
        // These used to be `data.closePrice ?? pos.price_current` and
        // `data.profit ?? pos.profit`. Both fallbacks are PRE-CLOSE values:
        // `pos.profit` is floating profit (excludes the exit deal) and
        // `pos.price_current` is the current quote, not the fill.
        //
        // Real damage: a bulk close of 26 EURUSD positions wrote
        // exitPrice=1.16257 and pnl=-9.02 on EVERY row with an identical
        // closedAt — buys and sells alike — because the shared fallback was
        // applied to each. That made the book's P&L unreadable and looked like
        // strategy losses. The bridge now returns the realised figure from the
        // closed deal; if it cannot, we RECOMPUTE from the actual exit price
        // rather than persisting a floating number as if it were realised.
        const bridgePnl = data.profit;
        const hasRealised = data.realized === true && bridgePnl != null;

        // Exit price: prefer the realised deal price, then the trade server's
        // actual fill price, and only then the pre-fill quote.
        const exitPrice = Number(
          (hasRealised ? data.closePrice : null) ?? data.closePrice ?? data.price ?? 0,
        );

        let pnl: number;
        if (hasRealised) {
          pnl = Number(bridgePnl);
        } else {
          // No realised figure — compute it from the exit price and the entry
          // that we recorded, honouring side. This is strictly better than
          // trusting a floating profit, and it cannot produce a shared value
          // across different entries.
          const entryPrice = Number(pos.price_open ?? 0);
          const volume = Number(pos.volume ?? 0);
          pnl = exitPrice > 0 && entryPrice > 0
            ? (exitPrice - entryPrice) * volume * (posType === 'sell' ? -1 : 1)
            : Number(bridgePnl ?? pos.profit ?? 0);
          this.logger.warn(
            `closePosition(${ticket}): bridge returned no realised P&L — recomputed ${pnl.toFixed(2)} ` +
            `from entry=${entryPrice} exit=${exitPrice} side=${posType}. ` +
            `If this recurs, the bridge build is predating the realised-profit fix.`,
          );
        }

        const existing = await this.prisma.trade.findFirst({
          where: { provider: 'mt5', brokerTicket: String(ticket), status: 'open' },
          orderBy: { openedAt: 'desc' },
        }).catch(() => null);
        if (existing) {
          // Explicit, not defaulted: this path is reached from the UI and from closeAll()/
          // closeProfitable(), so the actor is a person or an operator-initiated sweep.
          // ⚠️ #884 — the strategy must ride the close too. It was parsed 50 lines above and
          // then DROPPED here: rows closed through this branch kept strategy=NULL forever, which
          // is why the Strategy Comparison page showed 2 phantom rows out of 155 closes.
          await this.tradeRecorder.close(existing.id, exitPrice, pnl, CLOSE_REASONS.USER_MANUAL, strategyFromComment);
        } else {
          await this.tradeRecorder.record({
            symbol: pos.symbol,
            side: posType,
            quantity: pos.volume,
            entryPrice: pos.price_open || 0,
            exitPrice,
            pnl,
            provider: 'mt5',
            status: 'closed',
            origin: 'user',
            openedAt: pos.time ? new Date(pos.time * 1000) : undefined,
            strategy: strategyFromComment,
            brokerTicket: String(ticket),
          });
        }
      }

      return { success, error: data.error ?? data.comment };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async closePartial(ticket: number, volume: number): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.bridgeUrl}/close/partial/${ticket}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume }),
      });
      const data = await res.json();
      // Same success retcodes as closePosition (10008 placed / 10009 done / 10010 partial)
      return { success: data.success === true || [10008, 10009, 10010].includes(data.retcode), error: data.error ?? data.comment };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async modifyPosition(ticket: number, sl?: number, tp?: number): Promise<{ success: boolean; error?: string }> {
    try {
      const positions = await this.getPositions();
      const pos = positions.find((p) => p.ticket === ticket);
      const res = await fetch(`${this.bridgeUrl}/order/modify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket, sl, tp }),
      });
      const data = await res.json();
      // Modify can also return 10008 (placed) / 10009 (done) — treat both as success
      const success = data.success === true || [10008, 10009, 10010].includes(data.retcode);
      if (success && pos) {
        this.stopGuardian.recordAdjustment({
          tradeTicket: ticket,
          symbol: pos.symbol,
          oldSl: pos.sl || null,
          newSl: sl ?? pos.sl ?? null,
          oldTp: pos.tp || null,
          newTp: tp ?? pos.tp ?? null,
          reason: 'Manual SL/TP modification',
        });
      }
      return { success, error: data.error ?? data.comment };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async getHistory(days = 30): Promise<any[]> {
    try {
      const res = await fetch(`${this.bridgeUrl}/history?days=${days}`);
      if (!res.ok) return [];
      return res.json();
    } catch { return []; }
  }

  async closeAll(): Promise<{ closed: number; failed: number }> {
    const positions = await this.getPositions();
    let closed = 0;
    let failed = 0;
    for (const pos of positions) {
      const result = await this.closePosition(pos.ticket);
      result.success ? closed++ : failed++;
    }
    return { closed, failed };
  }

  /** Close only positions that are currently in profit. */
  async closeProfitable(): Promise<{
    closed: number;
    failed: number;
    skipped: number;
    totalPnl: number;
    closedTickets: { ticket: number; symbol: string; profit: number }[];
  }> {
    const positions = await this.getPositions();
    const profitable = positions.filter((p) => p.profit > 0);
    const unprofitable = positions.length - profitable.length;

    let closed = 0;
    let failed = 0;
    let totalPnl = 0;
    const closedTickets: { ticket: number; symbol: string; profit: number }[] = [];

    for (const pos of profitable) {
      const result = await this.closePosition(pos.ticket);
      if (result.success) {
        closed++;
        totalPnl += pos.profit;
        closedTickets.push({ ticket: pos.ticket, symbol: pos.symbol, profit: pos.profit });
      } else {
        failed++;
      }
    }

    this.logger.log(
      `closeProfitable: ${closed} closed, ${failed} failed, ${unprofitable} skipped, P&L=${totalPnl.toFixed(2)}`,
    );

    return { closed, failed, skipped: unprofitable, totalPnl, closedTickets };
  }
}
