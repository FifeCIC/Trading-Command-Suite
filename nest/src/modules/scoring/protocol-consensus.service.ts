/**
 * Protocol Consensus Engine
 * =========================
 * Runs ALL protocols against a symbol and produces an ensemble vote.
 *
 * Instead of choosing one protocol, this runs every protocol in the registry
 * and counts how many agree on BUY/SELL/HOLD. The consensus score represents
 * the percentage of protocols that agree on the dominant signal.
 *
 * This is a "wisdom of the crowd" approach — a BUY signal confirmed by
 * 25 of 32 protocols is far stronger than any single protocol's output.
 *
 * Architecture:
 *   1. Score symbol through each protocol via ProtocolGatingService
 *   2. Classify each result as bullish (≥65), bearish (<35), or neutral
 *   3. Compute weighted consensus (weights by confidence + protocol weight)
 *   4. Identify dissenting protocols (conflict detection)
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ScoringService } from './scoring.service';
import { ProtocolGatingService } from './protocol-gating.service';
import {
  PROTOCOL_REGISTRY,
  DirectiveGroup,
} from '../directives/directive-groups';

export interface ProtocolVote {
  protocolId: string;
  protocolName: string;
  tradingStyle?: string;
  score: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  riskMultiplier: number;
}

export interface ConsensusResult {
  symbol: string;
  symbolId: string;
  totalProtocols: number;
  scoredProtocols: number;
  votes: {
    bullish: number;
    bearish: number;
    neutral: number;
  };
  consensus: {
    dominantSignal: 'bullish' | 'bearish' | 'neutral' | 'mixed';
    agreementPct: number;          // % of scored protocols that agree
    weightedScore: number;         // Confidence-weighted average score
    conviction: 'strong' | 'moderate' | 'weak' | 'none';
  };
  topProtocols: ProtocolVote[];    // Highest-scoring protocols
  dissentingProtocols: ProtocolVote[]; // Protocols that disagree with consensus
  allVotes: ProtocolVote[];        // Full breakdown
  recommendation: string;
}

@Injectable()
export class ProtocolConsensusService {
  private readonly logger = new Logger(ProtocolConsensusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringService: ScoringService,
    private readonly protocolGating: ProtocolGatingService,
  ) {}

  /**
   * Run all protocols against a symbol and compute ensemble consensus.
   */
  async computeConsensus(symbol: string): Promise<ConsensusResult> {
    const sym = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
    if (!sym) {
      return this.emptyResult(symbol, `Symbol ${symbol} not found in database`);
    }

    const protocolIds = Object.keys(PROTOCOL_REGISTRY);
    const votes: ProtocolVote[] = [];

    // ── Score through each protocol ──
    for (const protocolId of protocolIds) {
      try {
        // Load bars for this symbol
        const rows = await this.prisma.marketBar.findMany({
          where: { symbolId: sym.id, timeframe: '1h' },
          orderBy: { timestamp: 'asc' },
          take: 100,
        });
        if (rows.length < 30) continue; // Need enough bars

        const bars = rows.map((r) => ({
          timestamp: r.timestamp, open: Number(r.open),
          high: Number(r.high), low: Number(r.low),
          close: Number(r.close), volume: Number(r.volume),
        }));

        const result = await this.protocolGating.scoreWithGating(
          symbol,
          bars,
          protocolId,
        );

        if (result && result.composite != null) {
          const signal: 'bullish' | 'bearish' | 'neutral' =
            result.composite >= 65 ? 'bullish' :
            result.composite < 35 ? 'bearish' : 'neutral';

          votes.push({
            protocolId,
            protocolName: PROTOCOL_REGISTRY[protocolId]?.name || protocolId,
            tradingStyle: PROTOCOL_REGISTRY[protocolId]?.tradingStyle,
            score: result.composite,
            signal,
            confidence: (result as any).confidence ?? 0.5,
            riskMultiplier: (result as any).riskMultiplier ?? 1.0,
          });
        }
      } catch (err) {
        // Protocol scoring can fail if bars are insufficient — skip
      }
    }

    if (votes.length === 0) {
      return this.emptyResult(symbol, 'No protocols produced valid scores — insufficient market data');
    }

    // ── Count votes ──
    const bullish = votes.filter(v => v.signal === 'bullish').length;
    const bearish = votes.filter(v => v.signal === 'bearish').length;
    const neutral = votes.filter(v => v.signal === 'neutral').length;

    // ── Determine dominant signal ──
    const maxVotes = Math.max(bullish, bearish, neutral);
    const dominantSignal: ConsensusResult['consensus']['dominantSignal'] =
      maxVotes === 0 ? 'mixed' :
      bullish === bearish && bullish >= neutral ? 'mixed' :
      bullish > bearish && bullish > neutral ? 'bullish' :
      bearish > bullish && bearish > neutral ? 'bearish' : 'neutral';

    const agreementPct = votes.length > 0 ? (maxVotes / votes.length) * 100 : 0;

    // ── Weighted consensus score ──
    const totalWeight = votes.reduce((s, v) => s + v.confidence, 0);
    const weightedScore = totalWeight > 0
      ? votes.reduce((s, v) => s + v.score * v.confidence, 0) / totalWeight
      : 50;

    // ── Conviction level ──
    const conviction: ConsensusResult['consensus']['conviction'] =
      agreementPct >= 75 ? 'strong' :
      agreementPct >= 55 ? 'moderate' :
      agreementPct >= 35 ? 'weak' : 'none';

    // ── Top and dissenting protocols ──
    const sorted = [...votes].sort((a, b) => b.score - a.score);
    const topProtocols = sorted.slice(0, 5);
    const dissentingProtocols = votes.filter(v =>
      dominantSignal !== 'mixed' && v.signal !== dominantSignal && v.signal !== 'neutral'
    ).sort((a, b) => b.confidence - a.confidence).slice(0, 5);

    // ── Recommendation ──
    const recommendation = this.buildRecommendation(
      dominantSignal, conviction, agreementPct, bullish, bearish, neutral,
      weightedScore, dissentingProtocols,
    );

    return {
      symbol,
      symbolId: sym.id,
      totalProtocols: protocolIds.length,
      scoredProtocols: votes.length,
      votes: { bullish, bearish, neutral },
      consensus: {
        dominantSignal,
        agreementPct: Math.round(agreementPct * 10) / 10,
        weightedScore: Math.round(weightedScore),
        conviction,
      },
      topProtocols,
      dissentingProtocols,
      allVotes: votes,
      recommendation,
    };
  }

  /**
   * Run consensus across multiple symbols (batch mode).
   */
  async batchConsensus(symbols: string[]): Promise<ConsensusResult[]> {
    const results: ConsensusResult[] = [];
    for (const sym of symbols.slice(0, 20)) { // Cap at 20 to avoid timeout
      try {
        results.push(await this.computeConsensus(sym));
      } catch { /* skip failed symbols */ }
    }
    return results.sort((a, b) => b.consensus.weightedScore - a.consensus.weightedScore);
  }

  private buildRecommendation(
    signal: string, conviction: string, agreement: number,
    bullish: number, bearish: number, neutral: number,
    score: number, dissenters: ProtocolVote[],
  ): string {
    if (conviction === 'none') return `No clear consensus — ${bullish}B/${bearish}S/${neutral}N across protocols. Wait for stronger alignment.`;

    const dir = signal === 'bullish' ? 'BUY' : signal === 'bearish' ? 'SELL' : 'HOLD';
    const strength = conviction === 'strong' ? 'high' : conviction === 'moderate' ? 'moderate' : 'low';

    let rec = `${strength.toUpperCase()} confidence ${dir}: ${agreement.toFixed(0)}% of protocols agree (${bullish}B/${bearish}S/${neutral}N). Weighted score: ${score}.`;

    if (dissenters.length > 0) {
      rec += ` ⚠️ Dissenters: ${dissenters.map(d => d.protocolName).join(', ')}.`;
    }

    return rec;
  }

  private emptyResult(symbol: string, reason: string): ConsensusResult {
    return {
      symbol, symbolId: '', totalProtocols: 0, scoredProtocols: 0,
      votes: { bullish: 0, bearish: 0, neutral: 0 },
      consensus: {
        dominantSignal: 'mixed', agreementPct: 0, weightedScore: 0,
        conviction: 'none',
      },
      topProtocols: [], dissentingProtocols: [], allVotes: [],
      recommendation: reason,
    };
  }
}
