import { Injectable, Logger } from '@nestjs/common';
import { TradeRecorderService } from './trade-recorder.service';
import { StopAdjustmentRecorder } from './stop-guardian.service';
import { buildOrderToPosition, buildClaimants, isContested } from './position-claimants';
import { CLOSE_REASONS } from '../../common/trading/close-reason';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import { Mt5SymbolRouter, orderRouteProblems } from '../providers/mt5/mt5-symbol-router.service';
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
    private readonly stopGuardian: StopAdjustmentRecorder,
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

  /**
   * urlFor() — the bridge that actually SERVES this symbol (#972).
   *
   * ⚠️ WHY THIS EXISTS. `getUrl()` with no argument returns the PRIMARY broker (`:5000`). Orders
already route correctly — `placeOrder()` resolves `route!.url` before posting — but every READ
looked only at the primary. Measured 2026-09-23: `GER40` and `VIX` are routed to broker 3
(`:5001`, Pepperstone) and **404 on `:5000`**, so the risk estimate received no spec and no
price, `price` came back `0`, and the per-symbol cap refused:
   *
   *   BLOCKED  Cannot evaluate the per-symbol cap for GER40: price is 0 (no quote)   ×35
   *   BLOCKED  Cannot evaluate the per-symbol cap for VIX:   price is 0 (no quote)   ×23
   *
   * The refusal was CORRECT — a cap that cannot be evaluated must not be passed. The fault was
   * that it was never evaluable, because the wrong broker was asked. GER40 and VIX are precisely
   * the two routed symbols absent from `:5000`; the other routed symbols exist on both bridges
   * and never produced this error, which is what identified the cause.
   *
   * ⚠️ FAIL-SAFE, falling back to the primary. A read that cannot resolve a route must behave as
   * it did before rather than throw — an unreadable route is not a reason to lose a price lookup,
   * and the caller's own `null` handling already turns a failed read into a refusal.
   *
   * ⚠️ Not the same rule as `getUrl()`, which THROWS on an explicit unregistered id (#914). Here
   * the id comes from a ROUTE, and a route to a non-MT5 broker (`0` = the crypto rows) must fall
   * back rather than throw.
   */
  private urlFor(symbol?: string): string {
    if (!symbol || !this.symbolRouter) return this.bridgeUrl;
    try {
      const brokerId = this.symbolRouter.getBrokerId(symbol);
      if (this.mt5Connection.isBroker(brokerId)) return this.mt5Connection.getUrl(brokerId);
    } catch { /* unresolved route — fall through to the primary */ }
    return this.bridgeUrl;
  }

  /**
   * getAllPositions() — EVERY open position on EVERY bridge, MAPPED (#1033).
   *
   * ⚠️ The row mapper is applied here rather than each caller doing its own. `getPositions()`
   * (primary-only) and this share `mapPosition()`, so a field added for one is added for both —
   * the failure mode of two mappers is that the primary-only one gets the fix.
   */
  async getAllPositions(): Promise<Array<Mt5Position & { brokerId: number }>> {
    const raw = await this.mt5Connection.getAllPositions();
    const ordered = [...raw].sort((a, b) => (a.brokerId ?? 0) - (b.brokerId ?? 0));
    return ordered.map((p: any) => ({ ...this.mapPosition(p), brokerId: Number(p.brokerId) }));
  }

  /**
   * positionsFrom() — positions on ONE bridge, mapped. Private: callers decide WHICH, never "the
   * default", which is the whole point of #1033.
   */
  private async positionsFrom(url: string): Promise<Mt5Position[]> {
    try {
      const res = await fetch(`${url}/positions`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return [];
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data?.positions;
      if (!Array.isArray(rows)) return [];
      return rows.map((p: any) => this.mapPosition(p));
    } catch { return []; }
  }

  /**
   * bridgeForTicket() — the bridge that holds this ticket, with a FAIL-SAFE fallback (#1033).
   *
   * ⚠️ WHY IT FALLS BACK RATHER THAN REFUSING. `findHoldingBroker()` returns `null` for BOTH
   * "no bridge reports this ticket" AND "a bridge could not be read". They are different facts, and
   * refusing on the second would turn a transient read failure into a failed close that the old
   * primary-only code would have completed.
   *
   * So: resolved → that bridge. Unresolved → the PRIMARY, exactly as before, WITH A WARNING. The
   * fix therefore only ever changes behaviour in the case it was written for — a ticket that is
   * genuinely held elsewhere — and can never be worse than the code it replaces.
   */
  private async bridgeForTicket(ticket: number): Promise<{ url: string; brokerId: number | null; resolved: boolean }> {
    try {
      const brokerId = await this.mt5Connection.findHoldingBroker(ticket);
      if (brokerId != null) return { url: this.mt5Connection.getUrl(brokerId), brokerId, resolved: true };
    } catch { /* registry unreachable — fall through to the primary, as before */ }
    this.logger.warn(
      `bridgeForTicket(${ticket}): no bridge reported this ticket — falling back to the PRIMARY ` +
        'bridge. If the position is held by another account the broker will refuse it, which is the ' +
        'same outcome as before #1033; a transient read failure looks identical from here.',
    );
    return { url: this.bridgeUrl, brokerId: null, resolved: false };
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

  /**
   * getPrimaryPositions() — PRIMARY bridge only, and the NAME now says so (#1033).
   *
   * ⚠️ It used to be called `getPositions()`, and that bare name is why the defect spread: it read
   * like "the positions" while returning one account's. Nine consumers reached for it, and the ones
   * that ACTED on the result closed and modified positions on the wrong account.
   *
   * ⚠️ **Do not call this on a path that ACTS.** `closePosition()` / `modifyPosition()` /
   * `closePartial()` resolve the holding bridge per ticket; `closeAll()` / `closeProfitable()` read
   * `getAllPositions()`. Use `getAllPositions()` for anything book-wide.
   *
   * ⚠️ THE ONE REMAINING CALLER IS THE DRAWDOWN GATE, and it is primary-scoped BY CONSTRUCTION:
   * it pairs these positions with `getAccount()`, which is genuinely a primary-account read (the
   * manager's own docs say so). Widening only the positions there would count two accounts' exposure
   * against one account's equity — a NEW inconsistency, so it is deliberately left consistent and
   * narrow, and this name is what stops the next consumer from inheriting it by accident.
   */
  async getPrimaryPositions(): Promise<Mt5Position[]> {
    return this.positionsFrom(this.bridgeUrl);
  }

  /** The ONE position row mapper. Shared so a field added for one caller exists for all. */
  private mapPosition(p: any): Mt5Position {
    return {
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
    };
  }

  /**
   * getPositionsManaged() — EVERY open position, EVERY bridge, with the facts needed to decide
   * what to do about it (#1037).
   *
   * ⚠️ WHY THIS EXISTS, AND WHY IT IS NOT `getPositions()`.
   *
   * `getPositions()` above reads `this.bridgeUrl` — the PRIMARY broker only (#1033, the read-path
   * half of #1030). Measured 2026-09-30: `symbol_route` sends XAGUSD / US500 / US30 / UK100 /
   * FRA40 / GER40 to brokerId **3**, and the guardian saw 8 of 14 positions. The six it could not
   * see held **77%** of the floating loss. A page built on `getPositions()` therefore shows less
   * than half the book, and shows it as if it were the whole of it.
   *
   * This method is ADDITIVE and deliberately leaves `getPositions()` alone. `getPositions()` is
   * consumed by `closeAll()` / `closePosition()` / `modifyPosition()`, which are MONEY PATHS: for
   * those, the question is not only "what is open?" but "WHICH BRIDGE do I send the close to?", and
   * changing their view of the world in the same commit as a read-only page is how a display fix
   * becomes an order-routing bug. #1033 owns that half.
   *
   * ⚠️ THREE FACTS ARE GATHERED PER POSITION, and each exists because its absence was the defect:
   *
   *   1. **`brokerId` + account + currency.** Two accounts hold this book (MetaQuotes-Demo, GBP;
   *      PepperstoneUK-Demo, USD). A row without its account is not actionable — the same symbol
   *      can be open on both, and the money is not the same money.
   *   2. **`fillCount`.** The −322.67 position was TEN fills sharing ONE `positionId`, opened by a
   *      different bot's order. The broker reports the NET volume (0.10) and never says how it got
   *      there, so a one-row-per-position view looks identical whether a position is a single
   *      deliberate trade or nine accidental scale-ins. Counted from the deal history, grouped by
   *      `position_id` with `entry === 0` (deal entry IN).
   *   3. **`recorded`** — the app's own `trade` row for this ticket, and whether its `quantity`
   *      reconciles to the broker's net volume. On the incident row the app said `0.01` while the
   *      broker said `0.10`, with `pnlInvalid = 0` asserting the row was usable. **A row whose size
   *      cannot produce its own P&L must not be shown as valid**, and that check cannot be made
   *      from either source alone.
   *
   * ⚠️ ATTRIBUTION IS NOT COMPUTED HERE. `StopAdjustmentRecorder` is the ONE owner of "which bot does
   * this position belong to", and it already publishes `ownerAttribution` including `unresolved`.
   * Re-deriving it from the comment or magic here would be a SECOND implementation of the rule that
   * caused the incident — `viaComment` failed precisely because the comment is mutable text another
   * order can overwrite. The caller joins `GET /api/automation/stop-guardian/status` instead.
   */
  async getPositionsManaged(): Promise<{
    fetchedAt: string;
    brokers: Array<Record<string, any>>;
    positions: Array<Record<string, any>>;
    gaps: string[];
  }> {
    const brokerIds = this.mt5Connection.getBrokerIds();
    const gaps: string[] = [];
    const brokers: Array<Record<string, any>> = [];
    const collected: Array<Record<string, any>> = [];
    // ⚠️ EVERY deal from EVERY bridge, collected so the derivation below runs ONCE over the whole
    // set. The app stores an ORDER ticket on `trade.brokerTicket`; MT5 gives each deal BOTH an
    // `orderId` and a `positionId` (measured 2026-09-30: of 10 real incident rows, 9 carried an
    // order id and 0 a position id), so the position is reachable only through the deals.
    // The derivation itself is `position-claimants.ts` — ONE implementation, shared with the
    // guardian (#1041), because two copies drift and only one gets the next fix.
    const allDeals: Array<Record<string, any>> = [];

    const perBroker = await Promise.all(
      brokerIds.map(async (brokerId) => {
        let url: string;
        try {
          url = this.mt5Connection.getUrl(brokerId);
        } catch {
          gaps.push(`broker ${brokerId}: not a registered bridge — cannot be read`);
          return { brokerId, rows: [] as Array<Record<string, any>> };
        }

        const [posRes, acctRes, dealRes] = await Promise.allSettled([
          fetch(`${url}/positions`, { signal: AbortSignal.timeout(10_000) }),
          fetch(`${url}/account`, { signal: AbortSignal.timeout(10_000) }),
          fetch(`${url}/history/deals?days=30`, { signal: AbortSignal.timeout(15_000) }),
        ]);

        // ⚠️ A FAILED READ IS NOT AN EMPTY ACCOUNT. "no positions" and "could not ask" must never
        // render the same — that is the difference between a flat book and a blind app.
        if (posRes.status !== 'fulfilled' || !posRes.value.ok) {
          gaps.push(`broker ${brokerId}: position read FAILED — its positions are NOT shown, which is not the same as having none`);
          return { brokerId, rows: [] as Array<Record<string, any>> };
        }

        const acct = acctRes.status === 'fulfilled' && acctRes.value.ok
          ? await acctRes.value.json().catch(() => null)
          : null;
        if (!acct) gaps.push(`broker ${brokerId}: account read FAILED — balance/currency unknown for its rows`);

        const label = acct
          ? `${acct.login ?? '?'} @ ${acct.server ?? '?'}`
          : `broker ${brokerId} (account unreadable)`;
        brokers.push({
          brokerId,
          url,
          login: acct?.login ?? null,
          server: acct?.server ?? null,
          currency: acct?.currency ?? null,
          balance: acct?.balance ?? null,
          equity: acct?.equity ?? null,
          marginFree: acct?.margin_free ?? acct?.marginFree ?? null,
          label,
        });

        const posData = await posRes.value.json().catch(() => null);
        const rows = (Array.isArray(posData) ? posData : posData?.positions) ?? [];
        if (!Array.isArray(rows)) return { brokerId, rows: [] as Array<Record<string, any>> };

        // Fill counts from the deal history, grouped by position id.
        //
        // ⚠️ CORRECTED 2026-09-30, by reading the payload rather than the MT5 docs. The first
        // version filtered on `Number(d.entry) === 0` to keep only deals that OPEN a position —
        // which is how MT5 models it — and every fill count came back `null`. The reason is that
        // the bridge does not send `entry` at all: measured on `/history/deals?days=30`, a deal
        // carries exactly `ticket, symbol, type, volume, price, profit, positionId, orderId,
        // commission, swap, fee, time, comment, reason`. A filter on an absent field excludes
        // everything, silently, and returns an empty map rather than an error.
        //
        // ⚠️ So this counts ALL deals for a positionId, and that is exact FOR THIS METHOD'S
        // PURPOSE: every row here is an OPEN position, which by definition has no closing deal yet.
        // The one exception is a position that has been PARTIALLY closed and is still open — that
        // one has a closing deal, so its count is one higher than its fill count. Widening this to
        // `entry` needs the field added to the bridge first; until then the number is honest for
        // the common case and is labelled "deals" on the page rather than claimed as "fills".
        const fills = new Map<string, number>();
        if (dealRes.status === 'fulfilled' && dealRes.value.ok) {
          const dealData = await dealRes.value.json().catch(() => null);
          for (const d of (dealData?.deals ?? [])) {
            const pid = String(d.positionId ?? d.position_id ?? '');
            if (!pid) continue;
            fills.set(pid, (fills.get(pid) ?? 0) + 1);
            // Collected, not mapped here — the whole set is needed before the order → position
            // mapping is built, so a deal seen on one bridge can be joined from another.
            allDeals.push(d);
          }
        } else {
          gaps.push(`broker ${brokerId}: deal history unreadable — fill counts unavailable for its rows`);
        }

        return {
          brokerId,
          rows: rows.map((p: any) => {
            const ticket = String(p.ticket);
            return {
              ticket,
              brokerId,
              brokerLabel: label,
              currency: acct?.currency ?? null,
              symbol: String(p.symbol ?? ''),
              side: Number(p.type) === 1 ? 'SELL' : 'BUY',
              netVolume: Number(p.volume ?? 0),
              fillCount: fills.get(ticket) ?? null,
              openTime: p.time ? new Date(Number(p.time) * 1000).toISOString() : null,
              priceOpen: Number(p.price_open ?? p.priceOpen ?? 0),
              priceCurrent: Number(p.price_current ?? p.priceCurrent ?? 0),
              sl: Number(p.sl ?? 0),
              tp: Number(p.tp ?? 0),
              profit: Number(p.profit ?? 0),
              comment: String(p.comment ?? ''),
            };
          }),
        };
      }),
    );

    for (const b of perBroker) collected.push(...b.rows);

    // ── The app's own row for each ticket, and whether it reconciles ──────────────────────────
    const tickets = collected.map((r) => r.ticket);
    const recorded = tickets.length
      ? await this.prisma.trade.findMany({
          where: { brokerTicket: { in: tickets }, status: 'open' },
          select: {
            id: true, brokerTicket: true, quantity: true, entryPrice: true, pnl: true,
            pnlInvalid: true, pnlInvalidReason: true, strategy: true, openedAt: true,
          },
        })
      : [];
    const byTicket = new Map(recorded.map((t) => [String(t.brokerTicket), t]));

    // ── CLAIMANTS — WHO ACTUALLY BUILT THIS POSITION (#1037) ────────────────────────────────
    //
    // ⚠️ A netting account has ONE position per symbol, so several bots' orders MERGE into it. The
    // incident's position was built from orders belonging to three different bots, and the broker
    // reports only the net — it never says the position has more than one author.
    //
    // This resolves the authors by going: app `brokerTicket` (an ORDER id) → deal → `positionId` →
    // the bot on that app row. More than one claimant means the position has **no single owner**,
    // and that is a FINDING to show, not an error to hide.
    //
    // ⚠️ Identity is the BOT (`scoringStrategyId` → `trading_strategy.name`), not the free-text
    // `strategy` column. `strategy` is the MT5 comment body — mutable text another order can
    // overwrite, which is the very thing that made the original attribution fail.
    const orderToPosition = buildOrderToPosition(allDeals);
    const orderIds = [...orderToPosition.keys()];
    const appOrderRows = orderIds.length
      ? await this.prisma.trade.findMany({
          where: { brokerTicket: { in: orderIds } },
          select: { brokerTicket: true, scoringStrategyId: true },
        })
      : [];
    const botIds = [...new Set(appOrderRows.map((r) => String(r.scoringStrategyId ?? '')).filter(Boolean))];
    const bots = botIds.length
      ? await this.prisma.tradingStrategy.findMany({ where: { id: { in: botIds } }, select: { id: true, name: true } })
      : [];
    const botNameById = new Map(bots.map((b) => [b.id, b.name]));

    // Identity is the BOT, never the free-text `strategy` column — see `position-claimants.ts`.
    const claimantsByPosition = buildClaimants(appOrderRows, orderToPosition, botNameById);

    // ⚠️ Typed explicitly. Without the annotation the spread of `Record<string, any>` contributes
    // no index signature to the inferred literal, so `row.profit` below does not type-check — the
    // object is narrower than it looks and the compiler is right to refuse it.
    const positions: Array<Record<string, any>> = collected.map((row) => {
      const rec = byTicket.get(row.ticket) ?? null;
      let divergence: Record<string, any> | null = null;
      if (rec) {
        const q = Number(rec.quantity ?? 0);
        // ⚠️ EXACT, not approximate: a half-sized or doubled record is a real finding, and a
        // tolerance would hide exactly the class of error this column exists to expose.
        if (q > 0 && Math.abs(row.netVolume - q) > 1e-9) {
          divergence = {
            recordedQuantity: q,
            netVolume: row.netVolume,
            factor: Number((row.netVolume / q).toFixed(4)),
            note:
              `app records ${q} but the broker holds ${row.netVolume} as ONE position — ` +
              `${row.fillCount ?? '?'} fill(s). Size and P&L are not from the same trade.`,
          };
        }
      }
      return {
        ...row,
        recorded: rec,
        divergence,
        // ⚠️ `contested` is the loud state: a position whose orders came from more than one bot has
        // no single owner, so no one bot's rules can be said to be managing it. Both fields are
        // always present — an empty array and a `false` are answers, and a missing field would read
        // as "not checked".
        claimants: claimantsByPosition.get(row.ticket) ?? [],
        contested: isContested(claimantsByPosition.get(row.ticket)),
      };
    });

    // Unreadable bridges first — a gap must not be the last thing a reader sees, and it must not
    // be invisible either. Ordering is information here.
    positions.sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit));

    return { fetchedAt: new Date().toISOString(), brokers, positions, gaps };
  }

  /**
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
        `${this.urlFor(symbol)}/symbol/${encodeURIComponent(symbol)}/info`,
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
   *
   * ⚠️ #1085 — `tickTime` is the BROKER's own last-tick time (offset-corrected UTC), distinct from
   * when this response was assembled. `undefined` = the bridge predates the contract; `null` = the
   * terminal reported no tick time. Both are refused by the sizing check, which NAMES which it saw
   * (`common/trading/quote-freshness.ts`) — do not collapse them into the `timestamp`.
   */
  async getQuote(symbol: string): Promise<{
    symbol?: string; bid: number; ask: number; last: number; tickTime?: Date | null;
  } | null> {
    try {
      const res = await fetch(
        `${this.urlFor(symbol)}/quote?symbol=${encodeURIComponent(symbol)}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return null;
      const d = await res.json();
      if (d?.error || d?.last == null) return null;
      return {
        symbol: typeof d.symbol === 'string' ? d.symbol : symbol,
        bid: Number(d.bid ?? 0),
        ask: Number(d.ask ?? 0),
        last: Number(d.last),
        tickTime: d.tickTime ? new Date(d.tickTime) : (d.tickTime === null ? null : undefined),
      };
    } catch { return null; }
  }

  /** Fetch candles from MT5 bridge for on-demand scoring (Sprint 2026-07-04) */
  async getCandles(symbol: string, timeframe = '1h', limit = 200): Promise<Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>> {    try {
      // ⚠️ #972 — bars come from the SAME routed broker as the symbol. A GER40 candle fetched from
      // the primary bridge returns nothing, which reads as "no data" rather than "wrong broker".
      const res = await fetch(`${this.urlFor(symbol)}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${Math.min(limit, 1000)}`);
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
    /**
     * #1018 — the owning bot's MT5 magic, for a caller that KNOWS the bot.
     *
     * ⚠️ Omitting it is legitimate for a purely manual order (there is no bot to attribute it to),
     * but the POSITION then carries the bridge's `DEFAULT_MAGIC` (234000 = "no bot attributed").
     * This path did not send a magic at ALL until 2026-09-29 — so even a caller that knew the bot
     * could not attribute the position.
     */
    magic?: number;
  }): Promise<{ success: boolean; ticket?: number; price?: number; error?: string; status?: string; filledQuantity?: number }> {
    const side = params.type === 'BUY' ? 'buy' : 'sell';
    const origin = (params.origin || 'user') as 'user' | 'agent' | 'strategy' | 'system';

    // ── CRYPTO ROUTE GUARD (#903, 2026-09-19 · shared #914, 2026-09-21) ───────────────────
    //
    // MT5 resolves an order symbol BY NAME with fuzzy matching. The measured hazard: the
    // `symbol_route` row for BTC was `→ binance, brokerId 0, brokerSymbol NULL`, so this method
    // would have handed the bare ticker `BTC` to an MT5 bridge — where it matches
    // `Nasdaq\ETF\BTC` (~$35.86), a different instrument at a different price, and FILLS.
    //
    // Until the crypto execution decision (#903) deliberately chooses an MT5 broker whose
    // contract list actually carries the instrument, a crypto ticker may only travel a route that
    // passes ALL of: an explicit `symbol_route` row, a brokerSymbol that is NOT the bare
    // ticker, and a target broker that is an active MT5 bridge. Anything less refuses here —
    // the last line before the bridge — and the refusal names exactly what is missing.
    //
    // ⚠️ The RULES live in `orderRouteProblems()` (mt5-symbol-router.service.ts) — ONE
    // implementation shared with `Mt5Adapter.placeOrder()` (the path manual trades and the
    // automation loop use) and `ExecutionFeasibilityService` (the pre-click card blocker).
    // #914 was the measured cost of those three sites disagreeing: a fabricated lot floor was
    // refused on the card's behalf while this guard — the true refusal — never ran.
    //
    // Non-crypto symbols are untouched: their identity mapping is the established behaviour.
    let orderUrl = this.bridgeUrl;
    let orderSymbol = params.symbol;
    if (venueForSymbol(params.symbol).kind === 'crypto') {
      const route = this.symbolRouter?.resolve(params.symbol) ?? null;
      const problems = orderRouteProblems(params.symbol, route, this.mt5Connection.getBrokerIds());
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
      // (`problems` empty ⇒ the route targets an active MT5 bridge, so `url` is non-null.)
      orderUrl = route!.url ?? this.bridgeUrl;
      orderSymbol = route!.brokerSymbol;
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
      // #1018 — the bridge reads this (`body.get('magic') or DEFAULT_MAGIC`); omitting it collapses
      // the position onto the default, where no bot owns it.
      if (params.magic != null) body.magic = params.magic;

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
          // ⚠️ THE OLD COMMENT HERE WAS FALSE AND THE VALUE WAS A LITERAL. It read "bridge
          // hardcodes magic=234000" — true before 2026-09-28, and wrong since: `mt5_bridge_v2.py`
          // now reads `body.get('magic') or DEFAULT_MAGIC`. Sending nothing made every position
          // carry 234000 while the row CLAIMED a value the request never produced.
          // Record the truth: what was sent, or NULL when no bot was known.
          magic: params.magic ?? null,
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
      // ⚠️ #1033 — SEND THE CLOSE TO THE BRIDGE THAT HOLDS THE TICKET, not to the primary.
      // Before this, a broker-3 position was closed by asking broker 2, which has never heard of
      // the ticket: the broker answered "no such position" and the operator saw a generic failure
      // rather than a routing bug. `bridgeForTicket` falls back to the primary when nothing reports
      // it, so this is strictly wider than the old behaviour and never narrower.
      const bridge = await this.bridgeForTicket(ticket);
      // Snapshot position before closing for audit trail — from the SAME bridge the close goes to,
      // so the recorded exit/entry cannot come from a different account's row.
      const positions = await this.positionsFrom(bridge.url);
      const pos = positions.find((p) => p.ticket === ticket);

      const res = await fetch(`${bridge.url}/close/${ticket}?origin=manual`, { method: 'POST' });
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
      // #1033 — the holding bridge, same reasoning as closePosition().
      // `origin: 'manual'` stamps `TCS:manual` on the closing deal (#916, 2026-10-07) — this is
      // the operator's close-partial action, and an unstamped close now reads as "the owner" by
      // default (owner direction, R46); a manual close should say so deliberately.
      const bridge = await this.bridgeForTicket(ticket);
      const res = await fetch(`${bridge.url}/close/partial/${ticket}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume, origin: 'manual' }),
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
      // #1033 — the holding bridge. A stop-loss moved on the wrong account is the worst version of
      // this defect: it succeeds against a position the operator was not looking at.
      const bridge = await this.bridgeForTicket(ticket);
      const positions = await this.positionsFrom(bridge.url);
      const pos = positions.find((p) => p.ticket === ticket);
      const res = await fetch(`${bridge.url}/order/modify`, {
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

  async closeAll(): Promise<{ closed: number; failed: number; brokers: number[] }> {
    // ⚠️ #1033 — READ EVERY BRIDGE. This used to read the PRIMARY only, so "close all" closed 7 of
    // 9 positions and reported success. The operator saw a flat book; two positions were still open.
    //
    // `closePosition()` resolves each ticket's own bridge, so no routing is repeated here.
    const all = await this.getAllPositions();
    // ⚠️ DEDUPED BY TICKET. Ticket numbers are unique only WITHIN an account, so the same number can
    // appear on two bridges as two different positions. `closePosition(ticket)` resolves to the
    // FIRST holder (`findHoldingBroker` logs the ambiguity), so a second attempt for the same number
    // would re-address the same account and fail against an already-closed position — reported as a
    // failure it is not. Deduping keeps the count honest; the ambiguity itself is logged where it is
    // detected rather than being silently resolved here.
    const seen = new Set<number>();
    const unique = all.filter((p) => (seen.has(p.ticket) ? false : (seen.add(p.ticket), true)));

    let closed = 0;
    let failed = 0;
    for (const pos of unique) {
      const result = await this.closePosition(pos.ticket);
      result.success ? closed++ : failed++;
    }
    return { closed, failed, brokers: [...new Set(all.map((p) => p.brokerId))].sort() };
  }

  /** Close only positions that are currently in profit. */
  async closeProfitable(): Promise<{
    closed: number;
    failed: number;
    skipped: number;
    totalPnl: number;
    closedTickets: { ticket: number; symbol: string; profit: number }[];
  }> {
    // ⚠️ #1033 — EVERY BRIDGE, same reason as closeAll(). A profitable position on the second
    // account was invisible here, which is the more expensive half: the sweep reported the profit it
    // had taken and silently left the rest running.
    //
    // ⚠️ `totalPnl` is a SUM ACROSS ACCOUNTS AND CURRENCIES (MetaQuotes-Demo is GBP,
    // PepperstoneUK-Demo is USD) — it was already a cross-symbol sum, and it is now a cross-account
    // one too. Reported as a single figure because the endpoint's shape is fixed; ⚠️ it is NOT a
    // meaningful money total and the per-ticket rows carry the account if it is ever needed.
    const all = await this.getAllPositions();
    // Deduped by ticket for the same reason as closeAll() — see the note there.
    const seen = new Set<number>();
    const positions = all.filter((p) => (seen.has(p.ticket) ? false : (seen.add(p.ticket), true)));
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
