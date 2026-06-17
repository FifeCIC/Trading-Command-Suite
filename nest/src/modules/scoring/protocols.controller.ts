/**
 * Protocols Controller
 * ====================
 * High-level view of all scoring protocols and their background activity.
 *
 * GET /api/scoring/protocols — list all protocols with activity data
 * GET /api/scoring/protocols/:id — single protocol detail with version history
 */

import { Controller, Get, Param, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DirectivesService } from '../directives/directives.service';
import { ScoringSchedulerService } from './scoring-scheduler.service';

interface ProtocolSummary {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  directiveCount: number;
  maxPossibleScore: number;
  lastRunAt: string | null;
  lastRunDurationMs: number | null;
  lastRunSymbols: number;
  status: 'idle' | 'running' | 'error' | 'disabled';
  createdAt: string;
}

@Controller('scoring/protocols')
export class ProtocolsController {
  private readonly logger = new Logger(ProtocolsController.name);

  /** In-memory activity log of recent protocol runs */
  private readonly activityLog: Array<{
    timestamp: string;
    protocolId: string;
    protocolName: string;
    event: 'started' | 'completed' | 'failed';
    symbolsScored?: number;
    durationMs?: number;
    error?: string;
  }> = [];
  private readonly MAX_ACTIVITY = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly directivesService: DirectivesService,
    private readonly schedulerService: ScoringSchedulerService,
  ) {}

  /** Record a protocol run event — called by ScoringScheduler */
  recordActivity(
    protocolId: string,
    protocolName: string,
    event: 'started' | 'completed' | 'failed',
    detail?: { symbolsScored?: number; durationMs?: number; error?: string },
  ): void {
    this.activityLog.unshift({
      timestamp: new Date().toISOString(),
      protocolId,
      protocolName,
      event,
      ...detail,
    });
    if (this.activityLog.length > this.MAX_ACTIVITY) this.activityLog.pop();
  }

  @Get()
  async listProtocols(): Promise<{
    protocols: ProtocolSummary[];
    scheduler: {
      enabled: boolean;
      intervalMs: number | null;
      nextRunIn: number | null;
      isRunning: boolean;
    };
    recentActivity: Array<{
      timestamp: string;
      protocolId: string;
      protocolName: string;
      event: 'started' | 'completed' | 'failed';
      symbolsScored?: number;
      durationMs?: number;
      error?: string;
    }>;
  }> {
    const protocols: ProtocolSummary[] = [];

    if (this.prisma.isAvailable) {
      try {
        const strategies = await this.prisma.strategy.findMany({
          include: { directives: true },
          orderBy: { name: 'asc' },
        });

        for (const s of strategies) {
          // Compute maxPossibleScore from directive maxScores
          let maxPossibleScore = 0;
          for (const d of s.directives) {
            if (d.active) {
              const impl = this.directivesService.get(d.type);
              maxPossibleScore += impl?.maxScore ?? 100;
            }
          }

          protocols.push({
            id: s.id,
            name: s.name,
            description: s.description,
            active: s.active,
            directiveCount: s.directives.filter((d) => d.active).length,
            maxPossibleScore,
            lastRunAt: null, // populated by scheduler when it tracks runs
            lastRunDurationMs: null,
            lastRunSymbols: 0,
            status: s.active ? 'idle' : 'disabled',
            createdAt: s.createdAt.toISOString(),
          });
        }
      } catch (err) {
        this.logger.error(`Failed to load protocols: ${String(err)}`);
      }
    }

    // Fallback: show the default protocol (all directives)
    if (protocols.length === 0) {
      const allDirectives = this.directivesService.list();
      const protocolMax = allDirectives.reduce((sum, d) => sum + d.maxScore, 0);

      protocols.push({
        id: 'default',
        name: 'Conviction Dip Accumulation',
        description: 'Default protocol: all registered directives with maxScore-based weighting.',
        active: true,
        directiveCount: allDirectives.length,
        maxPossibleScore: protocolMax,
        lastRunAt: null,
        lastRunDurationMs: null,
        lastRunSymbols: 0,
        status: 'idle',
        createdAt: new Date().toISOString(),
      });
    }

    const schedulerStatus = this.schedulerService.getStatus();

    return {
      protocols,
      scheduler: schedulerStatus,
      recentActivity: this.activityLog.slice(0, 50),
    };
  }

  @Get(':id')
  async getProtocol(@Param('id') id: string): Promise<{
    protocol: ProtocolSummary | null;
    directives: Array<{ id: string; name: string; maxScore: number; priority: number }>;
    versionHistory: Array<{ version: string; changedAt: string; changes: string }>;
  }> {
    let protocol: ProtocolSummary | null = null;
    const directiveList: Array<{ id: string; name: string; maxScore: number; priority: number }> = [];

    if (this.prisma.isAvailable && id !== 'default') {
      try {
        const s = await this.prisma.strategy.findUnique({
          where: { id },
          include: { directives: true },
        });

        if (s) {
          let maxPossibleScore = 0;
          for (const d of s.directives) {
            if (d.active) {
              const impl = this.directivesService.get(d.type);
              const maxScore = impl?.maxScore ?? 100;
              maxPossibleScore += maxScore;
              directiveList.push({
                id: d.type,
                name: impl?.name ?? d.name,
                maxScore,
                priority: impl?.priority ?? 50,
              });
            }
          }

          protocol = {
            id: s.id,
            name: s.name,
            description: s.description,
            active: s.active,
            directiveCount: s.directives.filter((d) => d.active).length,
            maxPossibleScore,
            lastRunAt: null,
            lastRunDurationMs: null,
            lastRunSymbols: 0,
            status: s.active ? 'idle' : 'disabled',
            createdAt: s.createdAt.toISOString(),
          };
        }
      } catch (err) {
        this.logger.error(`Failed to load protocol ${id}: ${String(err)}`);
      }
    }

    // Version history — placeholder until DB model added
    const versionHistory: Array<{ version: string; changedAt: string; changes: string }> = [];

    return { protocol, directives: directiveList, versionHistory };
  }
}
