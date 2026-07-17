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
  ) {}

  async getRotation(): Promise<SectorRotationResult> {
    const protocolMap: Record<string, { name: string; description: string }> = {};

    // Build protocol map from DB-backed cache
    for (const [id, reg] of Object.entries(this.protocolDb.getAllCached())) {
      protocolMap[id] = { name: reg.name, description: reg.description };
    }

    const sectors: SectorRotationResult['sectors'] = [];

    for (const sec of SECTOR_ETFS) {
      try {
        // Try Symbol lookup first, then direct symbolId search
        let bars = await this.prisma.marketBar.findMany({
          where: { symbol: { ticker: sec.etf } },
          orderBy: { timestamp: 'desc' },
          take: 100,
        });

        // Fallback: search by symbolId where the ticker is stored in the symbol table
        if (bars.length === 0) {
          const sym = await this.prisma.symbol.findFirst({
            where: { ticker: { contains: sec.etf } },
            select: { id: true },
          });
          if (sym) {
            bars = await this.prisma.marketBar.findMany({
              where: { symbolId: sym.id },
              orderBy: { timestamp: 'desc' },
              take: 100,
            });
          }
        }

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

        const marketBars = bars.map((b) => ({
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

        for (const pid of validProtocols) {
          try {
            const gated = await this.protocolGating.scoreWithGating(sec.etf, marketBars, pid);
            const score = gated.riskGate?.hardGateTriggered ? 0 : gated.composite;
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
