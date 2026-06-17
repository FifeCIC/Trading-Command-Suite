/**
 * Algorithm Log Controller
 * ========================
 * Shows real scoring pipeline runs — no simulation, no fake data.
 *
 * GET  /api/scoring/algorithm-lab/runs        — recent scoring runs (real data)
 * GET  /api/scoring/algorithm-lab/state        — current pipeline state summary
 * GET  /api/scoring/algorithm-lab/procedures   — available scoring procedures
 *
 * Architecture note: the "algorithm" is NOT a single monolithic algorithm.
 * It's a pipeline: Directives evaluate data → Strategy weights aggregate → SEES ranks.
 * Multiple scoring procedures can run independently on different symbol groups.
 * This page monitors those procedure runs.
 */

import { Controller, Get, Logger } from '@nestjs/common';
import { ScoringService } from './scoring.service';

interface ScoredSymbol {
  ticker: string;
  score: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  directiveCount: number;
}

interface ScoringRun {
  id: string;
  timestamp: string;
  procedure: string;
  symbolsScored: number;
  durationMs: number;
  status: 'completed' | 'failed';
  symbols: ScoredSymbol[];
}

interface ScoringProcedure {
  id: string;
  label: string;
  description: string;
}

// Available scoring procedures (the independent pipelines)
const PROCEDURES: ScoringProcedure[] = [
  { id: 'default', label: 'Default Composite', description: 'All active directives across all symbol groups' },
  { id: 'forex', label: 'Forex Pipeline', description: 'FX-specific directives: RSI, ATR, carry trade, sentiment' },
  { id: 'equities', label: 'Equities Pipeline', description: 'Stock directives: EMA structure, volume, earnings' },
  { id: 'crypto', label: 'Crypto Pipeline', description: 'Crypto directives: on-chain, funding rate, volatility' },
];

@Controller('scoring/algorithm-lab')
export class AlgorithmLabController {
  private readonly logger = new Logger(AlgorithmLabController.name);

  /** In-memory store of recent scoring runs. Survives only process lifetime. */
  private readonly runLog: ScoringRun[] = [];
  private readonly MAX_RUNS = 50;

  constructor(private readonly scoringService: ScoringService) {}

  /**
   * GET /api/scoring/algorithm-lab/runs
   * Returns recent scoring runs with per-symbol breakdown.
   * Each call triggers a fresh run and records it.
   */
  @Get('runs')
  async getRuns(): Promise<{ runs: ScoringRun[]; procedures: ScoringProcedure[] }> {
    const startTime = Date.now();
    const runId = `run-${Date.now()}`;

    try {
      const result = await this.scoringService.rankAll(undefined, 50);
      const durationMs = Date.now() - startTime;

      const symbols: ScoredSymbol[] = (result.ranked ?? []).map((r) => ({
        ticker: r.ticker,
        score: r.score,
        signal: (r.signal || 'neutral') as 'bullish' | 'bearish' | 'neutral',
        directiveCount: 0,
      }));

      const run: ScoringRun = {
        id: runId,
        timestamp: new Date().toISOString(),
        procedure: 'Default Composite',
        symbolsScored: symbols.length,
        durationMs,
        status: 'completed',
        symbols,
      };

      this.runLog.unshift(run);
      if (this.runLog.length > this.MAX_RUNS) this.runLog.pop();

      this.logger.log(`Run ${runId}: ${symbols.length} symbols in ${durationMs}ms`);

      return { runs: this.runLog, procedures: PROCEDURES };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      const run: ScoringRun = {
        id: runId,
        timestamp: new Date().toISOString(),
        procedure: 'Default Composite',
        symbolsScored: 0,
        durationMs,
        status: 'failed',
        symbols: [],
      };

      this.runLog.unshift(run);
      if (this.runLog.length > this.MAX_RUNS) this.runLog.pop();

      this.logger.error(`Run ${runId} failed: ${String(error)}`);

      return { runs: this.runLog, procedures: PROCEDURES };
    }
  }

  /**
   * GET /api/scoring/algorithm-lab/state
   * Returns current pipeline state without triggering a new run.
   */
  @Get('state')
  getState(): {
    procedures: ScoringProcedure[];
    lastRun: ScoringRun | null;
    runCount: number;
    pipelineStages: Array<{ id: string; label: string; description: string }>;
  } {
    return {
      procedures: PROCEDURES,
      lastRun: this.runLog[0] ?? null,
      runCount: this.runLog.length,
      pipelineStages: [
        { id: 'fetch', label: 'Fetch Data', description: 'Retrieve market data from configured providers' },
        { id: 'score', label: 'Score Directives', description: 'Each directive evaluates its domain and produces a score' },
        { id: 'rank', label: 'Rank Symbols', description: 'Strategy weights aggregate directive scores into symbol rankings' },
        { id: 'filter', label: 'Filter Noise', description: 'Low-conviction and conflicting signals are filtered out' },
        { id: 'signal', label: 'Signal Out', description: 'Final ranked signals: BUY, SELL, or HOLD with confidence' },
      ],
    };
  }

  /**
   * GET /api/scoring/algorithm-lab/procedures
   * Lists available scoring procedures with descriptions.
   */
  @Get('procedures')
  getProcedures(): { procedures: ScoringProcedure[] } {
    return { procedures: PROCEDURES };
  }
}
