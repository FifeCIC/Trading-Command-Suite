import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ProtocolDbService } from './protocol-db.service';
import { DirectivesService } from '../directives/directives.service';

/**
 * ProtocolHealthService — static protocol-config validation.
 * ===========================================================
 * Catches configuration faults BEFORE they corrupt scoring output. The
 * motivating bug (2026-09-03, #716 follow-up): vix-spike-v1 shipped with a
 * Sentiment group weighted 0.35 but ZERO directiveIds, so 35% of the
 * protocol's signal read 0 forever and manufactured permanent divergences.
 *
 * Scoring now treats empty groups as INACTIVE (neutral), but config faults
 * must still be surfaced — a silent neutral is better than a silent zero,
 * yet the config itself is wrong and needs a human decision. This service
 * flags it on boot and via GET /api/scoring/gated/protocols/health.
 */

export interface ProtocolHealthIssue {
  protocolId: string;
  groupId?: string;
  kind: 'empty-group' | 'unknown-directive' | 'no-risk-gate' | 'duplicate-directive' | 'zero-weight';
  severity: 'warning' | 'error';
  message: string;
}

@Injectable()
export class ProtocolHealthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProtocolHealthService.name);
  private lastIssues: ProtocolHealthIssue[] = [];
  private lastRunAt: string | null = null;

  constructor(
    private readonly protocolDb: ProtocolDbService,
    private readonly directives: DirectivesService,
  ) {}

  /** Validate every active protocol's group/directive wiring. */
  async validateAll(): Promise<ProtocolHealthIssue[]> {
    const issues: ProtocolHealthIssue[] = [];
    let slugs: string[] = [];
    try {
      slugs = await this.protocolDb.findAllActive();
    } catch {
      return issues;
    }

    for (const slug of slugs) {
      let config;
      try {
        config = this.protocolDb.getCached(slug) ?? (await this.protocolDb.findBySlug(slug));
      } catch {
        continue;
      }
      if (!config?.groups) continue;

      const seen = new Set<string>();
      const hasRiskGate = config.groups.some((g: any) => g.isRiskGate === true);

      for (const group of config.groups as any[]) {
        const groupId: string = group.id;
        const directiveIds: string[] = group.directiveIds ?? [];
        const weight = Number(group.weight ?? 0);

        if (weight > 0 && directiveIds.length === 0) {
          issues.push({
            protocolId: slug,
            groupId,
            kind: 'empty-group',
            severity: 'warning',
            message: `Group "${group.name ?? groupId}" has weight ${weight} but zero directives — it is scored as inactive (neutral). Add directives or remove/reweight the group.`,
          });
        }
        if (weight <= 0 && directiveIds.length > 0) {
          issues.push({
            protocolId: slug,
            groupId,
            kind: 'zero-weight',
            severity: 'warning',
            message: `Group "${group.name ?? groupId}" has ${directiveIds.length} directive(s) but zero weight — its directives never contribute.`,
          });
        }
        for (const directiveId of directiveIds) {
          if (seen.has(directiveId)) {
            issues.push({
              protocolId: slug,
              groupId,
              kind: 'duplicate-directive',
              severity: 'warning',
              message: `Directive "${directiveId}" appears in more than one group — double-counted.`,
            });
            continue;
          }
          seen.add(directiveId);
          const impl = this.directives.get(directiveId);
          if (!impl) {
            issues.push({
              protocolId: slug,
              groupId,
              kind: 'unknown-directive',
              severity: 'error',
              message: `Directive "${directiveId}" has no implementation registered — it will never score.`,
            });
          }
        }
      }

      if (!hasRiskGate) {
        issues.push({
          protocolId: slug,
          kind: 'no-risk-gate',
          severity: 'warning',
          message: 'Protocol has no risk-gate group (isRiskGate) — risk multiplier stays at the default.',
        });
      }
    }

    this.lastIssues = issues;
    this.lastRunAt = new Date().toISOString();
    return issues;
  }

  getLast(): { generatedAt: string | null; issues: ProtocolHealthIssue[] } {
    return { generatedAt: this.lastRunAt, issues: [...this.lastIssues] };
  }

  /** Log config faults once at boot so they're visible in the backend log too. */
  async onApplicationBootstrap() {
    try {
      const issues = await this.validateAll();
      for (const i of issues) {
        if (i.severity === 'error') {
          this.logger.warn(`Protocol config ERROR [${i.protocolId}]: ${i.message}`);
        } else {
          this.logger.log(`Protocol config warning [${i.protocolId}]: ${i.message}`);
        }
      }
      if (issues.length > 0) {
        this.logger.warn(`Protocol health: ${issues.length} config issue(s) across ${new Set(issues.map(i => i.protocolId)).size} protocol(s)`);
      }
    } catch (err) {
      this.logger.warn(`Protocol health validation failed: ${(err as Error).message}`);
    }
  }
}
