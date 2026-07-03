/**
 * MacroSnapshot Service
 * =====================
 * Persists DXY regime snapshots and detects regime changes
 * for notification dispatch. Called from ScoringService on each
 * scoring run after EURUSD/DXY data is fetched.
 *
 * Regime thresholds (mirrors dxy-regime.directive.ts):
 *   DXY >  108 → extreme (risk-off USD strength)
 *   DXY >= 105 → strong
 *   DXY <= 101 → weak
 *   otherwise  → neutral
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';

export type DxyRegime = 'weak' | 'neutral' | 'strong' | 'extreme';

export interface MacroSnapshotData {
  dxyValue?: number;
  eurusdValue?: number;
  dxyActual?: number;  // Direct DXY quote (not proxy)
  source: 'mt5' | 'finnhub' | 'eurusd-proxy';
}

const DXY_STRONG_THRESHOLD = 105;
const DXY_WEAK_THRESHOLD = 101;
const DXY_EXTREME_THRESHOLD = 108;

function classifyRegime(dxy: number): DxyRegime {
  if (dxy >= DXY_EXTREME_THRESHOLD) return 'extreme';
  if (dxy >= DXY_STRONG_THRESHOLD) return 'strong';
  if (dxy <= DXY_WEAK_THRESHOLD) return 'weak';
  return 'neutral';
}

@Injectable()
export class MacroSnapshotService {
  private readonly logger = new Logger(MacroSnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications?: NotificationService,
  ) {}

  /**
   * Persist a macro snapshot and fire notification if regime changed.
   * Called once per scoring run (not per symbol).
   */
  async capture(data: MacroSnapshotData): Promise<DxyRegime | null> {
    // Determine DXY value (direct or proxy)
    const effectiveDxy = data.dxyActual ?? data.dxyValue;
    if (effectiveDxy === undefined || effectiveDxy <= 0) {
      this.logger.debug('No DXY value to capture');
      return null;
    }

    const regime = classifyRegime(effectiveDxy);

    // Read the previous regime
    const previous = await this.getCurrentRegime();

    // Persist
    await this.prisma.macroSnapshot.create({
      data: {
        dxyValue: data.dxyValue ?? null,
        eurusdValue: data.eurusdValue ?? null,
        dxyActual: data.dxyActual ?? null,
        regime,
        source: data.source,
      },
    });

    // Detect & notify regime change
    if (previous && previous !== regime) {
      this.logger.log(`DXY regime change: ${previous} → ${regime} (DXY≈${effectiveDxy})`);
      await this.notifyRegimeChange(previous, regime, effectiveDxy, data.source);
    }

    return regime;
  }

  /** Get the most recent regime classification. */
  async getCurrentRegime(): Promise<DxyRegime | null> {
    const latest = await this.prisma.macroSnapshot.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { regime: true, dxyValue: true, createdAt: true },
    });
    if (!latest) return null;
    return latest.regime as DxyRegime;
  }

  /** Get the most recent snapshot with full data. */
  async getLatest() {
    return this.prisma.macroSnapshot.findFirst({
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get regime history for the last N hours. */
  async getHistory(hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.prisma.macroSnapshot.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /** Fire notification on regime change. */
  private async notifyRegimeChange(
    from: DxyRegime,
    to: DxyRegime,
    dxyValue: number,
    source: string,
  ): Promise<void> {
    if (!this.notifications) return;

    const emoji = to === 'extreme' ? '🔴' : to === 'strong' ? '🟠' : to === 'weak' ? '🟢' : '🔵';
    const sourceLabel = source === 'eurusd-proxy' ? ' (EURUSD proxy)' : '';

    const title = `${emoji} DXY Regime: ${from.toUpperCase()} → ${to.toUpperCase()}`;
    const body = `DXY ≈ ${dxyValue}${sourceLabel}. `;
    const impact = this.describeImpact(to);
    const fullBody = body + impact;

    try {
      await this.notifications.send({
        event: 'dxy-regime-change',
        title,
        body: fullBody,
        metadata: { from, to, dxyValue, source },
      });
    } catch (err) {
      this.logger.debug(`Failed to send regime notification: ${(err as Error).message}`);
    }
  }

  /** Human-readable impact description for the regime. */
  private describeImpact(regime: DxyRegime): string {
    switch (regime) {
      case 'extreme':
        return 'Risk-off — gold & majors bearish, USD pairs surging. Tighten stops.';
      case 'strong':
        return 'USD strengthening — bearish for gold, commodities, and majors. Favor USD longs.';
      case 'weak':
        return 'USD weakening — bullish for gold, commodities, and risk assets.';
      case 'neutral':
        return 'No strong dollar bias — trade symbol-specific setups.';
    }
  }
}
