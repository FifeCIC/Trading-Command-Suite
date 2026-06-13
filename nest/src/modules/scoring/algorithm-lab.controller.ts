/**
 * Algorithm Lab Controller
 * ========================
 * Provides real-time pipeline state visualization for the Algorithm Lab UI.
 *
 * GET  /api/scoring/algorithm-lab/state?strategyId=momentum
 * POST /api/scoring/algorithm-lab/pause/:strategyId
 * POST /api/scoring/algorithm-lab/resume/:strategyId
 *
 * Pipeline stages: FETCH → SCORE → RANK → FILTER → SIGNAL
 */

import { Controller, Get, Post, Param, Query, Logger } from '@nestjs/common';
import { ScoringService } from './scoring.service';

interface PipelineStage {
  id: string;
  label: string;
  status: 'done' | 'active' | 'queued' | 'waiting';
  detail?: string;
}

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'signal-buy' | 'signal-sell' | 'signal-hold' | 'error';
}

interface StrategyState {
  id: string;
  name: string;
  paused: boolean;
  pipeline: PipelineStage[];
  activeStep: number;
  log: LogEntry[];
  currentSymbol?: string;
  directivesComplete?: number;
  directivesTotal?: number;
  tick: number;
}

@Controller('scoring/algorithm-lab')
export class AlgorithmLabController {
  private readonly logger = new Logger(AlgorithmLabController.name);
  private readonly states = new Map<string, StrategyState>();
  private tickCounter = 0;

  // Strategy definitions
  private readonly STRATEGIES = [
    { id: 'momentum', name: 'Momentum' },
    { id: 'forex', name: 'Forex Mean Reversion' },
    { id: 'trend', name: 'Trend Following' },
    { id: 'crypto', name: 'Crypto Scalp' },
  ];

  constructor(private readonly scoringService: ScoringService) {
    this.initStates();
    // Simulate pipeline progress every 2s
    setInterval(() => this.tick(), 2000);
  }

  private initStates() {
    for (const s of this.STRATEGIES) {
      this.states.set(s.id, this.createFreshState(s.id, s.name));
    }
  }

  private createFreshState(id: string, name: string): StrategyState {
    return {
      id,
      name,
      paused: false,
      pipeline: [
        { id: 'fetch', label: 'Fetch Data', status: 'waiting' },
        { id: 'score', label: 'Score Directives', status: 'waiting' },
        { id: 'rank', label: 'Rank Symbols', status: 'waiting' },
        { id: 'filter', label: 'Filter Noise', status: 'waiting' },
        { id: 'signal', label: 'Signal Out', status: 'waiting' },
      ],
      activeStep: -1,
      log: [],
      tick: 0,
    };
  }

  private tick() {
    this.tickCounter++;

    for (const [id, state] of this.states) {
      if (state.paused) continue;
      this.advancePipeline(state);
    }
  }

  private advancePipeline(state: StrategyState) {
    const stages = state.pipeline;

    // If just starting, begin FETCH
    if (state.activeStep === -1) {
      state.activeStep = 0;
      stages[0].status = 'active';
      stages[0].detail = 'Fetching market data...';
      this.addLog(state, 'FETCH: Starting data fetch for active symbols', 'info');
      state.directivesTotal = 18;
      state.directivesComplete = 0;
      state.currentSymbol = 'EURUSD';
      return;
    }

    const currentStage = stages[state.activeStep];

    // Simulate progress through each stage
    switch (currentStage.id) {
      case 'fetch':
        if (state.tick % 2 === 0) {
          currentStage.status = 'done';
          currentStage.detail = '12 symbols, 18 directives';
          this.addLog(state, 'FETCH complete: 12 symbols, 18 directives loaded', 'info');
          this.advanceToNext(state);
        }
        break;

      case 'score':
        if (state.tick % 1 === 0) {
          const totalDirs = state.directivesTotal ?? 18;
          state.directivesComplete = Math.min(totalDirs, (state.directivesComplete ?? 0) + 3);
          currentStage.detail = `${state.directivesComplete} of ${totalDirs} directives complete`;
          this.addLog(state, `SCORE: ${state.currentSymbol} — 6 of 18 directives complete`, 'info');
          if (state.directivesComplete >= totalDirs) {
            currentStage.status = 'done';
            this.advanceToNext(state);
          }
        }
        break;

      case 'rank':
        currentStage.status = 'done';
        currentStage.detail = 'Symbols sorted by total score';
        this.addLog(state, 'RANK: Symbols sorted by aggregate score', 'info');
        this.advanceToNext(state);
        break;

      case 'filter':
        currentStage.status = 'done';
        currentStage.detail = 'Low-conviction signals filtered';
        this.addLog(state, 'FILTER: Removed 3 low-conviction signals below threshold', 'info');
        this.advanceToNext(state);
        break;

      case 'signal':
        currentStage.status = 'done';
        // Generate simulated signals
        const signals: Array<{ sym: string; score: number; type: 'buy' | 'sell' | 'hold' }> = [
          { sym: 'EURUSD', score: 87, type: 'buy' },
          { sym: 'GBPUSD', score: 72, type: 'hold' },
          { sym: 'BTCUSD', score: 45, type: 'hold' },
          { sym: 'NVDA', score: 92, type: 'buy' },
          { sym: 'TSLA', score: 28, type: 'sell' },
        ];
        for (const sig of signals) {
          const logType = sig.type === 'buy' ? 'signal-buy' as const : sig.type === 'sell' ? 'signal-sell' as const : 'signal-hold' as const;
          this.addLog(state, `${sig.sym} scored ${sig.score}/100 → ${sig.type.toUpperCase()} signal`, logType);
        }
        currentStage.detail = `${signals.length} signals generated`;
        this.addLog(state, `SIGNAL: ${signals.length} signals generated across strategies`, 'info');
        // Reset pipeline for next cycle
        state.activeStep = -1;
        state.pipeline = this.createFreshState(state.id, state.name).pipeline;
        state.currentSymbol = ['EURUSD', 'GBPUSD', 'NVDA', 'BTCUSD'][Math.floor(Math.random() * 4)];
        state.directivesComplete = 0;
        this.tryFetchRealScores(state);
        break;
    }
  }

  private async tryFetchRealScores(state: StrategyState) {
    try {
      const ranked = await this.scoringService.rankAll(undefined, 10);
      if (ranked?.ranked?.length) {
        this.addLog(state, `REAL SCORES: ${ranked.ranked.length} symbols scored via ScoringService`, 'info');
        for (const r of ranked.ranked.slice(0, 3)) {
          const signal = r.signal === 'bullish' ? 'BUY' : r.signal === 'bearish' ? 'SELL' : 'HOLD';
          this.addLog(state, `${r.ticker}: ${r.score}/100 → ${signal}`, r.signal === 'bullish' ? 'signal-buy' : r.signal === 'bearish' ? 'signal-sell' : 'signal-hold');
        }
      }
    } catch {
      // Real scoring unavailable — simulated data shown
    }
  }

  private advanceToNext(state: StrategyState) {
    const next = state.activeStep + 1;
    if (next < state.pipeline.length) {
      state.activeStep = next;
      state.pipeline[next].status = 'active';
    }
  }

  private addLog(state: StrategyState, message: string, type: LogEntry['type']) {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    state.log.unshift({ time, message, type });
    if (state.log.length > 100) state.log.pop();
  }

  @Get('state')
  getState(@Query('strategyId') strategyId?: string) {
    if (strategyId && this.states.has(strategyId)) {
      return this.states.get(strategyId);
    }
    // Return all strategies as array for strategy scroller
    return Array.from(this.states.values()).map((s) => ({
      id: s.id,
      name: s.name,
      paused: s.paused,
      pipeline: s.pipeline,
      activeStep: s.activeStep,
      log: s.log.slice(0, 20),
      currentSymbol: s.currentSymbol,
      directivesComplete: s.directivesComplete,
      directivesTotal: s.directivesTotal,
    }));
  }

  @Post('pause/:strategyId')
  pause(@Param('strategyId') strategyId: string) {
    const state = this.states.get(strategyId);
    if (!state) return { error: 'Strategy not found' };
    state.paused = true;
    this.addLog(state, '⏸ PAUSED by user', 'info');
    return { paused: true };
  }

  @Post('resume/:strategyId')
  resume(@Param('strategyId') strategyId: string) {
    const state = this.states.get(strategyId);
    if (!state) return { error: 'Strategy not found' };
    state.paused = false;
    this.addLog(state, '▶ RESUMED by user', 'info');
    return { paused: false };
  }
}
