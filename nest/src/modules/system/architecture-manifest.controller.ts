import { Controller, Get } from '@nestjs/common';
import { ModeService } from '../../config/mode.service';
import { PrismaService } from '../../database/prisma.service';
import { ProvidersService } from '../providers/providers.service';

/**
 * Architecture Manifest — machine-readable system map for AI agents and developers.
 *
 * Provides a single JSON endpoint that aggregates architecture facts from:
 *  - System mode & health
 *  - Provider status & capabilities
 *  - Module inventory
 *  - System spine (data flow pipeline)
 *  - Architecture index (24 sections)
 *  - UI page structure (nav-tree areas & views)
 *  - Cross-page links for agent traversal
 *
 * GET /api/architecture/manifest
 */
@Controller('api/architecture')
export class ArchitectureManifestController {
  constructor(
    private readonly modeService: ModeService,
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
  ) {}

  @Get('manifest')
  async getManifest() {
    const modeInfo = this.modeService.getModeInfo();

    // ── Provider health ──
    let providers: any[] = [];
    try {
      const health = await this.providersService.getHealth();
      providers = (health.providers || []).map((p: any) => ({
        name: p.name || p.provider,
        status: p.status || 'unknown',
        quotes: p.quotes ?? null,
        candles: p.candles ?? null,
        news: p.news ?? null,
        fundamentals: p.fundamentals ?? null,
        checkedAt: p.checkedAt || null,
      }));
    } catch {
      providers = [];
    }

    // ── Database status ──
    let dbStatus = 'unknown';
    try {
      if (this.prisma.isAvailable) {
        await this.prisma.$queryRaw`SELECT 1`;
        dbStatus = 'connected';
      } else {
        dbStatus = 'disconnected';
      }
    } catch {
      dbStatus = 'error';
    }

    // ── System mode ──
    const systemMode = modeInfo.mode === 'fallback' ? 'fallback' : 'full';
    const queueStatus = modeInfo.queue ? 'available' : 'disabled';

    return {
      _meta: {
        description: 'Trading Command Suite — machine-readable architecture manifest for AI agents and developers.',
        generatedAt: new Date().toISOString(),
        version: 'nest-0.1.0',
        uiPages: {
          architectureFramework: '/builder/architecture-framework',
          diagrams: '/builder/diagrams',
          capabilityMap: '/status/capability-map',
        },
      },

      system: {
        mode: systemMode,
        database: dbStatus,
        queue: queueStatus,
        redis: modeInfo.redis ? 'connected' : 'unavailable',
        uptime: process.uptime(),
      },

      providers,

      modules: MODULE_INVENTORY,

      systemSpine: SYSTEM_SPINE,

      architectureIndex: ARCHITECTURE_INDEX,

      navTree: NAV_TREE_SUMMARY,
    };
  }
}

// ── Static Data (kept here as canonical source; mirrors frontend architecture-framework.data.js) ──

const MODULE_INVENTORY = [
  { name: 'Auth', route: '/api/auth', description: 'Authentication and authorization' },
  { name: 'Symbols', route: '/api/symbols', description: 'Symbol CRUD and search' },
  { name: 'Market Data', route: '/api/market-data', description: 'Quotes, candles, snapshots' },
  { name: 'Providers', route: '/api/providers', description: 'Provider adapters, health, rate limits' },
  { name: 'Import Jobs', route: '/api/import-jobs', description: 'Data import queue and history' },
  { name: 'Scoring', route: '/api/scoring', description: 'Scoring runs, live stack, arena, diagnostics' },
  { name: 'Directives', route: '/api/directives', description: 'Directive registry, status, groups' },
  { name: 'Strategies', route: '/api/strategies', description: 'Strategy CRUD, duplication, templates' },
  { name: 'Portfolio', route: '/api/portfolio', description: 'Portfolio, positions, history, Trading212 import' },
  { name: 'Signals', route: '/api/signals', description: 'Trading signals and decision support' },
  { name: 'Trading', route: '/api/trading', description: 'Trading execution and order management' },
  { name: 'Trading Gates', route: '/api/trading-gates', description: 'Risk gates and execution controls' },
  { name: 'Risk', route: '/api/risk', description: 'Risk controls and position limits' },
  { name: 'Alerts', route: '/api/alerts', description: 'Alert center, lifecycle, severity levels' },
  { name: 'Calibration', route: '/api/calibrations', description: 'Symbol/directive weight overrides' },
  { name: 'Indicators', route: '/api/indicators', description: 'S/R, volatility, RSI, MACD, SMA, correlation' },
  { name: 'Macro', route: '/api/macro', description: 'Macro indicators and FRED data' },
  { name: 'News', route: '/api/news', description: 'News feed, articles, import, sentiment' },
  { name: 'Snapshots', route: '/api/snapshots', description: 'Market snapshots and replay' },
  { name: 'Timeline', route: '/api/timeline', description: 'Timeline and event tracking' },
  { name: 'Training', route: '/api/training', description: 'Candle patterns, pattern accuracy' },
  { name: 'Backtest', route: '/api/backtest', description: 'Backtest engine with chart overlays' },
  { name: 'Webhooks', route: '/api/webhooks', description: 'External webhook receivers' },
  { name: 'Scheduler', route: '/api/scheduler', description: 'Cron job management' },
  { name: 'Export', route: '/api/export', description: 'Data export endpoints' },
  { name: 'Cache', route: '/api/cache', description: 'Cache monitor and management' },
  { name: 'API Activity', route: '/api/api-activity', description: 'API usage and rate limit tracking' },
  { name: 'Journal', route: '/api/journal', description: 'Trade journal entries' },
  { name: 'FX', route: '/api/fx', description: 'FX rate endpoints' },
  { name: 'Plan', route: '/api/plan', description: 'Trading plan management' },
  { name: 'Scenarios', route: '/api/scenarios', description: 'What-if scenario testing' },
  { name: 'ISA', route: '/api/isa', description: 'ISA account management' },
  { name: 'Notifications', route: '/api/notifications', description: 'Push notification delivery' },
  { name: 'Performance', route: '/api/performance', description: 'Performance analytics' },
  { name: 'FAQ', route: '/api/faq', description: 'FAQ entries' },
  { name: 'System', route: '/api/system', description: 'Logs, metrics, process management' },
];

const SYSTEM_SPINE = [
  'Symbol selected',
  'Freshness checked',
  'Import triggered if stale or missing',
  'Market data stored',
  'Condition detection runs (entropy, Hurst, session, BOS, range)',
  'Activation gate evaluates suitability vs conditions (active/reduced/muted/boosted)',
  'Directives executed (entry + exit), calibration overrides applied',
  'Strategy aggregates directive outputs',
  'Score and breakdown stored',
  'Exit urgency evaluated alongside entry score',
  'SEES ranks symbols',
  'User inspects rationale and timeframe fit',
];

const ARCHITECTURE_INDEX = [
  { name: 'Status snapshot', status: 'done' },
  { name: 'Architecture index', status: 'done' },
  { name: 'Architecture tree', status: 'done' },
  { name: 'Decision workflow', status: 'done' },
  { name: 'Feature decision matrix', status: 'done' },
  { name: 'Intake template', status: 'done' },
  { name: 'Discovery commands', status: 'done' },
  { name: 'Information sources', status: 'done' },
  { name: 'System context', status: 'done' },
  { name: 'Owner directory', status: 'done' },
  { name: 'Contract inventory', status: 'done' },
  { name: 'Current contract register', status: 'done' },
  { name: 'Queue/provider contract', status: 'done' },
  { name: 'Scoring/strategy contract', status: 'done' },
  { name: 'Calibration system', status: 'done' },
  { name: 'Activation gate and conditions', status: 'done' },
  { name: 'Exit signal system', status: 'done' },
  { name: 'Alert center architecture', status: 'done' },
  { name: 'AI guardrails', status: 'done' },
  { name: 'Verification governance', status: 'done' },
  { name: 'Definition of done', status: 'done' },
  { name: 'Handoff checklist', status: 'done' },
  { name: 'Known gaps', status: 'done' },
  { name: 'Revision log', status: 'done' },
];

const NAV_TREE_SUMMARY = {
  areas: 12,
  totalViews: 99,
  areasList: [
    { key: 'trading', label: 'Trading', views: 10 },
    { key: 'scoring', label: 'Scoring', views: 13 },
    { key: 'research', label: 'Research', views: 12 },
    { key: 'analysis', label: 'Analysis', views: 7 },
    { key: 'data', label: 'Data', views: 12 },
    { key: 'watchlists', label: 'Watchlists', views: 4 },
    { key: 'automation', label: 'Automation', views: 4 },
    { key: 'builder', label: 'Development', views: 9 },
    { key: 'training', label: 'Training', views: 4 },
    { key: 'status', label: 'Status', views: 13 },
    { key: 'lab', label: 'Lab', views: 9 },
    { key: 'settings', label: 'Settings', views: 5 },
  ],
};
