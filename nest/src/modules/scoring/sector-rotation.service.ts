/**
 * Sector Rotation Service
 * ========================
 * Scores sector ETFs under applicable protocols and returns
 * stratified performance data showing which protocols perform best per sector.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ProtocolGatingService } from './protocol-gating.service';
import { ProtocolDbService } from './protocol-db.service';
import { MarketDataService } from '../market-data/market-data.service';

const SECTOR_ETFS = [
  { etf: 'XLK', name: 'Technology', protocols: ['spy-speed-v1', 'momentum-stock-v1', 'qqq-speed-v1', 'leverage-v2'] as string[] },
  { etf: 'XLF', name: 'Financials', protocols: ['spy-speed-v1', 'momentum-stock-v1', 'forex-session-v1'] as string[] },
  { etf: 'XLE', name: 'Energy', protocols: ['oil-speed-v1', 'oil-supply-v1'] as string[] },
  { etf: 'XLV', name: 'Healthcare', protocols: ['spy-speed-v1', 'pandemic-v1'] as string[] },
  { etf: 'XLY', name: 'Consumer Disc.', protocols: ['spy-speed-v1', 'momentum-stock-v1'] as string[] },
  { etf: 'XLP', name: 'Consumer Staples', protocols: ['spy-speed-v1', 'spy-day-v1'] as string[] },
  { etf: 'XLI', name: 'Industrials', protocols: ['dow-speed-v1', 'spy-speed-v1'] as string[] },
  { etf: 'XLB', name: 'Materials', protocols: ['gold-macro-v1', 'dxy-sensitivity-v1'] as string[] },
  { etf: 'XLRE', name: 'Real Estate', protocols: ['spy-speed-v1', 'spy-day-v1'] as string[] },
  { etf: 'XLU', name: 'Utilities', protocols: ['spy-speed-v1'] as string[] },
  { etf: 'XLC', name: 'Communication', protocols: ['qqq-speed-v1', 'momentum-stock-v1'] as string[] },
];

export interface SectorRotationResult {
  sectors: Array<{
    etf: string;
    name: string;
    performance: { d1: number; w1: number; m1: number };
    momentum: number;
    trend: number;
    bestProtocol: { id: string; name: string; score: number } | null;
    protocolScores: Array<{ protocolId: string; protocolName: string; score: number; signal: string }>;
    hasData: boolean;
  }>;
  protocolMap: Record<string, { name: string; description: string }>;
  generatedAt: string;
}

@Injectable()
export class SectorRotationService {
  private readonly logger = new Logger(SectorRotationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly protocolGating: ProtocolGatingService,
    private readonly protocolDb: ProtocolDbService,
    private readonly marketData: MarketDataService,
  ) {}

  /**
   * SectorRotationService — sector ETF relative-strength / rotation census.
   *
   * ⚠️ #754 — the bar window used to be two hand-rolled `prisma.marketBar.findMany` queries
   * that took `desc` but never reversed AND never filtered `timeframe`. The ordering made the
   * positional reads (`length-2`, `length-6`, `length-22`) measure the WRONG bars, and the
   * missing filter silently spliced cadences together. Now loaded through the canonical
   * `MarketDataService.getBars()` at a pinned single cadence (INV-BAR-WINDOW,
   * INV-SINGLE-CADENCE).
   */
  async getRotation(): Promise<SectorRotationResult> {
    const protocolMap: Record<string, { name: string; description: string }> = {};

    // Build protocol map from DB-backed cache
    for (const [id, reg] of Object.entries(this.protocolDb.getAllCached())) {
      protocolMap[id] = { name: reg.name, description: reg.description };
    }

    const sectors: SectorRotationResult['sectors'] = [];

    for (const sec of SECTOR_ETFS) {
      try {
        // ⚠️ Cadence is pinned to '1h' DELIBERATELY — do not "correct" it to '1d'.
        //
        // The d1/w1/m1 labels are misleading legacies: they are not 1-day, 1-week and
        // 1-month returns. They are POSITIONAL — `length-2`, `length-6`, `length-22` — so
        // their real meaning is "whatever the window's cadence is, per bar". The sector ETFs
        // in `marketbar` hold ONLY 1h bars (verified 2026-09-10: all 11 XL* tickers, 35–41
        // bars each), so these are ~2h / ~6h / ~22h moves despite the names.
        //
        // Pinning to '1d' returns zero bars and silently flips every sector to `hasData:false`
        // (a regression introduced and caught during #754). The previous hand-rolled query
        // looked like it worked only because it had no `timeframe` filter and took whatever
        // rows happened to be newest. NOTE: naming these d1/w1/m1 on a 1h window is a real
        // (separate) correctness issue for the UI — see #756.
        const secSym = await this.prisma.symbol.findFirst({
          where: { ticker: sec.etf },
          select: { id: true },
        });
        const bars = secSym
          ? await this.marketData.getBars(secSym.id, '1h', 100)
          : [];
        if (bars.length < 5) {
          sectors.push({
            etf: sec.etf,
            name: sec.name,
            performance: { d1: 0, w1: 0, m1: 0 },
            momentum: 0,
            trend: 0,
            bestProtocol: null,
            protocolScores: [],
            hasData: false,
          });
          continue;
        }

        const marketBars = bars.map((b: any) => ({
          timestamp: b.timestamp,
          open: Number(b.open), high: Number(b.high),
          low: Number(b.low), close: Number(b.close),
          volume: Number(b.volume),
        }));

        // Compute performance
        const last = marketBars[marketBars.length - 1].close;
        const d1Idx = Math.max(0, marketBars.length - 2);
        const w1Idx = Math.max(0, marketBars.length - 6);
        const m1Idx = Math.max(0, marketBars.length - 22);
        const perf = {
          d1: +(((last - marketBars[d1Idx].close) / marketBars[d1Idx].close) * 100).toFixed(1),
          w1: +(((last - marketBars[w1Idx].close) / marketBars[w1Idx].close) * 100).toFixed(1),
          m1: +(((last - marketBars[m1Idx].close) / marketBars[m1Idx].close) * 100).toFixed(1),
        };

        // Score under applicable protocols
        const protocolScores: SectorRotationResult['sectors'][0]['protocolScores'] = [];
        let bestProtocol: SectorRotationResult['sectors'][0]['bestProtocol'] = null;

        // Filter to protocols that exist in registry
        const validProtocols = sec.protocols.filter((p) => this.protocolDb.getCached(p));

        const secSymForBundle = secSym;
        const { dayBars, hourBars, min15Bars } = secSymForBundle
          ? await this.protocolGating.loadHigherTfBundle(secSymForBundle.id)
          : { dayBars: [], hourBars: [], min15Bars: [] };

        for (const pid of validProtocols) {
          try {
            const gated = await this.protocolGating.scoreWithGating(sec.etf, marketBars, pid, { dayBars, hourBars, min15Bars });
            const score = gated.riskGate?.hardGateTriggered ? 0 : gated.signalPct;
            protocolScores.push({
              protocolId: pid,
              protocolName: this.protocolDb.getCached(pid)?.name || pid,
              score,
              signal: gated.signal,
            });

            if (!bestProtocol || score > bestProtocol.score) {
              bestProtocol = { id: pid, name: this.protocolDb.getCached(pid)?.name || pid, score };
            }
          } catch {
            // Skip failed protocols
          }
        }

        sectors.push({
          etf: sec.etf,
          name: sec.name,
          performance: perf,
          momentum: perf.d1,   // short-term
          trend: perf.m1,       // long-term
          bestProtocol,
          protocolScores,
          hasData: true,
        });
      } catch (err) {
        this.logger.warn(`Sector ${sec.etf} failed: ${(err as Error).message}`);
        sectors.push({
          etf: sec.etf, name: sec.name,
          performance: { d1: 0, w1: 0, m1: 0 },
          momentum: 0, trend: 0,
          bestProtocol: null, protocolScores: [], hasData: false,
        });
      }
    }

    return {
      sectors,
      protocolMap,
      generatedAt: new Date().toISOString(),
    };
  }
}
