/**
 * pnl-contribution.service.ts — WHAT ACTUALLY MADE (OR LOST) THE MONEY, BY INSTRUMENT.
 *
 * ── WHY THIS EXISTS (owner, 2026-11-27) ─────────────────────────────────────────────────────────
 * *"I have seen a turnaround … The outcomes are skewed by gold though: those movements are big and all
 * it takes is some luck with gold and the entire accounts look healthier."*
 *
 * Measured the same day, on 30 days of closed trades: net **−417.53**, of which gold was **−0.75**. The
 * most recent week was **+142.53** net — and **−113.86 excluding gold**. So the suspicion was not a
 * suspicion: **one instrument decided the sign of the account**, and nothing in the app showed it. A
 * portfolio summary whose headline is a single blended number cannot distinguish "the system is turning
 * around" from "gold had a week", and those two findings demand opposite decisions.
 *
 * ── THE TWO RULES THIS ENFORCES ────────────────────────────────────────────────────────────────
 *
 * ⚠️ **1. "METALS" IS READ FROM THE DATABASE, NEVER FROM A LIST IN THIS FILE.** A hardcoded
 * `['XAUUSD','XAGUSD']` is one user's world (`external-systems-are-data`): a second account trades
 * XPTUSD, and a literal would silently exclude it. The classification comes from `symbol.tags`, and the
 * RESULT NAMES ITS OWN BASIS — `metalsSource` plus the resolved symbol list — so a reader can see how the
 * split was drawn rather than trusting a label.
 *
 * ⚠️ **2. THE SPLIT IS ALWAYS SHOWN BESIDE THE TOTAL, NEVER INSTEAD OF IT.** A headline figure that has
 * been silently filtered is the "derived number hides the data it came from" defect. `total` is returned
 * whether or not metals exist, and `exMetals` is `null` (not `0`) when there is nothing left — because
 * "no non-metal trades" and "the non-metal trades broke even" are different facts.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────────
 * It does not rank strategies, does not claim an edge, and does not touch sizing. It reports realised
 * P&L on CLOSED trades, because that is the only P&L that is a fact rather than a mark.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** One instrument's realised result over the window. */
export interface InstrumentContribution {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  /** Percentage of closed trades that were profitable; `null` when nothing closed. */
  winRate: number | null;
  net: number;
  grossWin: number;
  grossLoss: number;
  /** `true` when `symbol.tags` names it a metal — see `metalsSource` on the response. */
  isMetal: boolean;
}

export interface ContributionSplit {
  trades: number;
  net: number;
  grossWin: number;
  grossLoss: number;
}

export interface PnlContribution {
  window: { days: number; from: string; to: string };
  /** Every instrument that closed at least one trade, largest absolute contribution first. */
  byInstrument: InstrumentContribution[];
  /** The whole account over the window. Always present, never filtered. */
  total: ContributionSplit;
  /** Metals only. `null` when no metal closed a trade — NOT a zero. */
  metals: ContributionSplit | null;
  /**
   * Everything that is not a metal. ⚠️ `null`, NOT `0`, when there is nothing left: "the rest was empty"
   * and "the rest broke even" are different facts and a summary must not merge them.
   */
  exMetals: ContributionSplit | null;
  /** How the split was drawn, and with what. A label without its basis is a claim nobody can check. */
  metalsSource: { basis: 'symbol.tags'; tag: string; symbols: string[] };
  /** Commodities that are NOT metals, named so a reader can see what was excluded and why. */
  otherCommodities: string[];
}

/** Tolerance for the metals tag comparison — the seeded vocabulary is inconsistent, see below. */
const METALS_TAG = 'metals';

/**
 * isMetalTagged(tags) — PURE, and deliberately tolerant of the singular.
 *
 * ⚠️ MEASURED 2026-11-27: `symbol.tags` holds `"metal"` on **XAUUSD** and `"metals"` on **XAGUSD** —
 * one tag, two spellings, in the same seeded table. A strict `=== 'metals'` match would have reported
 * gold as a non-metal and made this whole panel lie in the most dangerous direction (the instrument that
 * dominates the account excluded from the instrument that dominates the account). Both spellings are
 * accepted here, and the inconsistency is reported by `metalsSource.symbols` so it stays visible.
 */
export function isMetalTagged(tags: unknown): boolean {
  if (!Array.isArray(tags)) return false;
  return tags.some((t) => {
    const s = String(t ?? '').trim().toLowerCase();
    return s === METALS_TAG || s === 'metal';
  });
}

/** PURE: fold one instrument's closed trades into a row. Percentages keep 2dp so two rows can be compared. */
export function summariseInstrument(
  symbol: string,
  pnls: readonly number[],
  isMetal: boolean,
): InstrumentContribution {
  const n = pnls.length;
  const wins = pnls.filter((p) => p > 0).length;
  const losses = pnls.filter((p) => p < 0).length;
  const grossWin = pnls.filter((p) => p > 0).reduce((a, p) => a + p, 0);
  const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((a, p) => a + p, 0));
  return {
    symbol,
    trades: n,
    wins,
    losses,
    winRate: n ? Math.round((wins / n) * 10000) / 100 : null,
    net: Math.round((grossWin - grossLoss) * 10000) / 10000,
    grossWin: Math.round(grossWin * 10000) / 10000,
    grossLoss: Math.round(grossLoss * 10000) / 10000,
    isMetal,
  };
}

/** PURE: fold rows into a split, or `null` when the population is empty. */
export function summariseSplit(rows: readonly InstrumentContribution[]): ContributionSplit | null {
  if (!rows.length) return null;
  const trades = rows.reduce((a, r) => a + r.trades, 0);
  if (!trades) return null;
  return {
    trades,
    net: Math.round(rows.reduce((a, r) => a + r.net, 0) * 10000) / 10000,
    grossWin: Math.round(rows.reduce((a, r) => a + r.grossWin, 0) * 10000) / 10000,
    grossLoss: Math.round(rows.reduce((a, r) => a + r.grossLoss, 0) * 10000) / 10000,
  };
}

@Injectable()
export class PnlContributionService {
  private readonly logger = new Logger(PnlContributionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getContribution(days = 30): Promise<PnlContribution> {
    const windowDays = Math.max(1, Math.min(365, Number(days) || 30));
    const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    /**
     * ⚠️ CLOSED TRADES ONLY, WITH A REAL `pnl`. An open position's P&L is a mark, and a row with
     * `pnl: null` is a trade that did not settle — counting either as a result is how a summary reports
     * money that has not been made.
     */
    const trades = await this.prisma.trade.findMany({
      where: { status: 'closed', pnl: { not: null }, closedAt: { gte: from } },
      select: { symbol: true, pnl: true },
    });

    const symbols = [...new Set(trades.map((t) => t.symbol))];
    const symbolRows = symbols.length
      ? await this.prisma.symbol.findMany({
          where: { ticker: { in: symbols } },
          select: { ticker: true, type: true, tags: true },
        })
      : [];
    const meta = new Map(symbolRows.map((s) => [s.ticker, s]));

    const grouped = new Map<string, number[]>();
    for (const t of trades) {
      if (!grouped.has(t.symbol)) grouped.set(t.symbol, []);
      grouped.get(t.symbol)!.push(Number(t.pnl));
    }

    const byInstrument = [...grouped.entries()]
      .map(([symbol, pnls]) => summariseInstrument(symbol, pnls, isMetalTagged(meta.get(symbol)?.tags)))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

    const metalsRows = byInstrument.filter((r) => r.isMetal);
    const exMetalsRows = byInstrument.filter((r) => !r.isMetal);

    // Commodities the tag does NOT call a metal — named so a reader can see the boundary of the split.
    const otherCommodities = symbolRows
      .filter((s) => s.type === 'commodity' && !isMetalTagged(s.tags))
      .map((s) => s.ticker)
      .sort();

    const payload: PnlContribution = {
      window: { days: windowDays, from: from.toISOString(), to: new Date().toISOString() },
      byInstrument,
      total: summariseSplit(byInstrument) ?? { trades: 0, net: 0, grossWin: 0, grossLoss: 0 },
      metals: summariseSplit(metalsRows),
      exMetals: summariseSplit(exMetalsRows),
      metalsSource: { basis: 'symbol.tags', tag: `${METALS_TAG} (or 'metal')`, symbols: metalsRows.map((r) => r.symbol).sort() },
      otherCommodities,
    };

    this.logger.log(
      `Contribution ${windowDays}d: ${payload.total.trades} closed trade(s), net ${payload.total.net} ` +
        `(metals ${payload.metals?.net ?? 'none'}, ex-metals ${payload.exMetals?.net ?? 'none'})`,
    );
    return payload;
  }
}
