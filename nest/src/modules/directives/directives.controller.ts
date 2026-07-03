import { Controller, Get, Patch, Post, Delete, Param, Query, Body } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DirectivesService } from './directives.service';
import { PROTOCOL_REGISTRY } from './directive-groups';

@ApiTags('directives')
@Controller('directives')
export class DirectivesController {
  constructor(private readonly directivesService: DirectivesService) {}

  @Get()
  @ApiOperation({ summary: 'List all registered directives with metadata' })
  @ApiOkResponse({ description: 'Array of directive definitions' })
  async list() {
    const directives = this.directivesService.list();

    // Load active-status from DB
    const dbStatuses = new Map<string, boolean>();
    try {
      const dbDirectives = await this.directivesService.getDbStatuses();
      for (const d of dbDirectives) {
        dbStatuses.set(d.id, d.active);
      }
    } catch { /* DB might not be available */ }

    // Build a category map from all protocol groups
    const directiveCategory = new Map<string, string>();
    for (const proto of Object.values(PROTOCOL_REGISTRY)) {
      for (const group of proto.groups) {
        for (const did of group.directiveIds) {
          if (!directiveCategory.has(did)) {
            directiveCategory.set(did, group.name);
          }
        }
      }
    }

    // Fallback category map for directives not assigned to any protocol group
    const FALLBACK_CATEGORIES: Record<string, string> = {
      // Technical Analysis — indicators, patterns, chart-based
      'atr-dip': 'Technical Analysis', 'adx': 'Technical Analysis', 'stochastic': 'Technical Analysis',
      'mfi': 'Technical Analysis', 'momentum-continuation-combo': 'Technical Analysis',
      'price-above-sma': 'Technical Analysis', 'ma-crossover': 'Technical Analysis',
      'moving-averages': 'Technical Analysis', 'bollinger-bands': 'Technical Analysis',
      'bollinger-band-squeeze': 'Technical Analysis', 'cci': 'Technical Analysis',
      'obv': 'Technical Analysis', 'volume-rhythm': 'Technical Analysis', 'vwap': 'Technical Analysis',
      'volume-surge': 'Technical Analysis', 'doji-pattern': 'Technical Analysis',
      'hammer-pattern': 'Technical Analysis', 'engulfing-pattern': 'Technical Analysis',
      'three-soldiers-pattern': 'Technical Analysis', 'pin-bar-pattern': 'Technical Analysis',
      'price-action': 'Technical Analysis', 'support-resistance-levels': 'Technical Analysis',
      'overhead-supply-pressure': 'Technical Analysis', 'resistance-levels-strategy': 'Technical Analysis',
      'volatility-tools': 'Technical Analysis', 'volatility-envelope': 'Technical Analysis',
      'confluence-reversal-combo': 'Technical Analysis', 'macd': 'Technical Analysis',
      'mean-reversion': 'Technical Analysis',
      'mt5-engulfing': 'Technical Analysis', 'mt5-harami': 'Technical Analysis',
      'mt5-star-doji': 'Technical Analysis', 'mt5-hammer': 'Technical Analysis',
      // Market Context — time-based, calendar, regime
      'monday-effect': 'Market Context', 'friday-positioning': 'Market Context',
      'midweek-momentum': 'Market Context', 'advanced-weekly-rhythm': 'Market Context',
      'basic-weekly-rhythm': 'Market Context', 'weekly-rhythm-strategy': 'Market Context',
      'intraday-u-pattern': 'Market Context', 'spy-options-expiry': 'Market Context',
      'spy-month-end-rebalancing': 'Market Context', 'spy-qqq-relative-strength': 'Market Context',
      'market-regime': 'Market Context', 'institutional-timing': 'Market Context',
      // Sentiment & Fundamentals
      'news-sentiment-positive': 'Sentiment & Fundamentals',
      'dividend-yield-attractive': 'Sentiment & Fundamentals',
      'nvda-earnings-momentum': 'Sentiment & Fundamentals',
      'tsla-sentiment-amplifier': 'Sentiment & Fundamentals',
      'conviction-growth': 'Sentiment & Fundamentals',
      'like-zacks': 'Sentiment & Fundamentals',
      'earnings-implementation': 'Sentiment & Fundamentals',
      'earnings-whispers': 'Sentiment & Fundamentals',
      'analyst-adjustments': 'Sentiment & Fundamentals',
      // Risk & Structural
      'position-size-kelly': 'Risk & Structural', 'position-size-confidence': 'Risk & Structural',
      'panic-exhaustion-absorption': 'Risk & Structural', 'time-based-support': 'Risk & Structural',
      'isa-reset': 'Risk & Structural', 'portfolio-performance': 'Risk & Structural',
      'adaptive-risk-monitor': 'Risk & Structural',
      // Exit Signals
      'momentum-exhaustion': 'Exit Signals', 'target-achieved': 'Exit Signals',
      'regime-shift-exit': 'Exit Signals', 'time-stop': 'Exit Signals',
      // Strategy Composites
      'sp500-regime': 'Strategy Composites', 'vix-strategy': 'Strategy Composites',
    };

    for (const [id, cat] of Object.entries(FALLBACK_CATEGORIES)) {
      if (!directiveCategory.has(id)) directiveCategory.set(id, cat);
    }

    // Complexity scoring: based on data sources and computation type
    const complexityMap: Record<string, { level: number; label: string; factors: string[] }> = {};
    for (const d of directives) {
      const factors: string[] = [];
      let level = 1;

      if (d.id.includes('multi') || d.id.includes('combo') || d.id.includes('composite')) { level += 2; factors.push('multi-factor'); }
      if (['atr-dip', 'adx', 'volatility-tools', 'bollinger-band-squeeze', 'volatility-envelope'].includes(d.id)) { level += 1; factors.push('statistical'); }
      if (['earnings-momentum', 'social-buzz', 'insider-activity', 'dilution-impact', 'news-sentiment-positive', 'earnings-proximity'].includes(d.id)) { level += 1; factors.push('external-data'); }
      if (['gold-macro-correlation', 'cad-usd-oil-correlation', 'dxy-regime', 'vix-regime'].includes(d.id)) { level += 2; factors.push('multi-source'); }
      if (['budget-gate', 'liquidity-check', 'rollover-risk', 'position-size-kelly', 'position-size-confidence'].includes(d.id)) { level += 1; factors.push('risk-calculation'); }
      if (['mt5-engulfing', 'mt5-harami', 'mt5-star-doji', 'mt5-hammer'].includes(d.id)) { level += 1; factors.push('pattern-detection'); }
      if (d.priority && d.priority >= 70) { level += 1; factors.push('high-priority'); }

      const labels = ['Basic', 'Simple', 'Moderate', 'Complex', 'Advanced', 'Expert'];
      complexityMap[d.id] = {
        level: Math.min(level, 6),
        label: labels[Math.min(level - 1, 5)],
        factors,
      };
    }

    // Compute protocolCount: how many protocols include each directive
    const protocolCounts = new Map<string, number>();
    for (const proto of Object.values(PROTOCOL_REGISTRY)) {
      const seen = new Set<string>();
      for (const group of proto.groups) {
        for (const did of group.directiveIds) {
          if (!seen.has(did)) { seen.add(did); }
        }
      }
      for (const did of seen) {
        protocolCounts.set(did, (protocolCounts.get(did) ?? 0) + 1);
      }
    }

    return directives.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description ?? '',
      category: directiveCategory.get(d.id) ?? 'Other',
      priority: d.priority ?? 50,
      protocolCount: protocolCounts.get(d.id) ?? 0,
      complexity: complexityMap[d.id] ?? { level: 1, label: 'Basic', factors: [] },
      active: dbStatuses.has(d.id) ? dbStatuses.get(d.id) : true,
    }));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Toggle a directive active/inactive' })
  async toggleDirective(
    @Param('id') id: string,
    @Body() body: { active: boolean },
  ) {
    // Find or create DB Directive row, then toggle
    const directive = await this.directivesService.upsertDirective(id, body.active);
    return { id, active: body.active, persisted: true };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━
  //  Fork endpoints (Q301b)
  // ━━━━━━━━━━━━━━━━━━━━━━━━

  @Get('forks')
  @ApiOperation({ summary: 'List all directive forks' })
  async listForks() {
    const forks = await this.directivesService.getForks();
    return { forks };
  }

  @Get('effective')
  @ApiOperation({ summary: 'Get effective directive for a strategy (fork or original)' })
  async getEffective(
    @Query('directiveId') directiveId: string,
    @Query('strategyId') strategyId: string,
  ) {
    const directive = await this.directivesService.getEffectiveDirective(
      directiveId,
      strategyId,
    );
    return { directive };
  }

  @Post(':id/fork')
  @ApiOperation({ summary: 'Create a fork of a directive for a strategy' })
  async fork(
    @Param('id') id: string,
    @Body() body: { strategyId: string; weight?: number; config?: any; reason?: string },
  ) {
    const fork = await this.directivesService.forkDirective(
      id,
      body.strategyId,
      { weight: body.weight, config: body.config, reason: body.reason },
    );
    return { fork };
  }

  @Delete(':id/revert')
  @ApiOperation({ summary: 'Revert a fork — delete it and fall back to parent' })
  async revert(@Param('id') id: string) {
    const result = await this.directivesService.revertFork(id);
    return result;
  }
}
