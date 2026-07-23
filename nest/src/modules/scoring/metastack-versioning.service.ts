import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class MetaStackVersioningService {
  private readonly logger = new Logger(MetaStackVersioningService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a snapshot of the current strategy state.
   * Auto-increments the semantic version.
   */
  async createSnapshot(scoringStrategyId: string, createdBy?: string) {
    const strategy = await this.prisma.scoringStrategy.findUnique({
      where: { id: scoringStrategyId },
      include: { protocolLinks: true },
    });
    if (!strategy) throw new NotFoundException(`Strategy ${scoringStrategyId} not found`);

    // Get latest version to increment
    const latest = await this.prisma.metaStackSnapshot.findFirst({
      where: { scoringStrategyId },
      orderBy: { createdAt: 'desc' },
    });

    const nextVersion = latest ? this.bumpVersion(latest.version) : '1.0.0';

    // Build snapshot payload
    const snapshotData = {
      name: strategy.name,
      protocolId: strategy.protocolId,
      shortProtocolId: strategy.shortProtocolId,
      watchlistName: strategy.watchlistName,
      watchlistId: strategy.watchlistId,
      brokerId: strategy.brokerId,
      mode: strategy.mode,
      tradeThreshold: strategy.tradeThreshold,
      baseSize: strategy.baseSize,
      slPct: strategy.slPct,
      tpPct: strategy.tpPct,
      maxPyramidTiers: strategy.maxPyramidTiers,
      slTpInheritance: strategy.slTpInheritance,
      weightStrategy: strategy.weightStrategy,
      protocolLinks: strategy.protocolLinks?.map(p => ({
        protocolSlug: p.protocolSlug,
        role: p.role,
        sortOrder: p.sortOrder,
      })) || [],
    };

    const fingerprint = this.hashSnapshot(snapshotData);

    const snapshot = await this.prisma.metaStackSnapshot.create({
      data: {
        scoringStrategyId,
        version: nextVersion,
        snapshot: snapshotData,
        fingerprint,
        createdBy: createdBy || 'system',
      },
    });

    // Record change log
    await this.prisma.metaStackChangeLog.create({
      data: {
        scoringStrategyId,
        fromVersion: latest?.version || null,
        toVersion: nextVersion,
        summary: `Snapshot ${nextVersion} created`,
        details: latest ? { previousVersion: latest.version } : { initial: true },
        author: createdBy || 'system',
      },
    });

    this.logger.log(`Snapshot ${nextVersion} created for strategy ${scoringStrategyId}`);
    return snapshot;
  }

  /** List all snapshots for a strategy with change log */
  async getVersions(scoringStrategyId: string) {
    const [snapshots, changeLogs] = await Promise.all([
      this.prisma.metaStackSnapshot.findMany({
        where: { scoringStrategyId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, version: true, fingerprint: true, createdAt: true, createdBy: true },
      }),
      this.prisma.metaStackChangeLog.findMany({
        where: { scoringStrategyId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { snapshots, changeLogs };
  }

  /** Restore a strategy to a previous snapshot */
  async restoreSnapshot(scoringStrategyId: string, snapshotId: string) {
    const snapshot = await this.prisma.metaStackSnapshot.findFirst({
      where: { id: snapshotId, scoringStrategyId },
    });
    if (!snapshot) throw new NotFoundException(`Snapshot ${snapshotId} not found`);

    const data = snapshot.snapshot as any;

    await this.prisma.scoringStrategy.update({
      where: { id: scoringStrategyId },
      data: {
        name: data.name,
        protocolId: data.protocolId,
        shortProtocolId: data.shortProtocolId,
        watchlistName: data.watchlistName,
        watchlistId: data.watchlistId,
        brokerId: data.brokerId,
        mode: data.mode,
        tradeThreshold: data.tradeThreshold,
        baseSize: data.baseSize,
        slPct: data.slPct,
        tpPct: data.tpPct,
        maxPyramidTiers: data.maxPyramidTiers,
        slTpInheritance: data.slTpInheritance,
        weightStrategy: data.weightStrategy,
      },
    });

    // Create a new snapshot marking the restore
    await this.prisma.metaStackChangeLog.create({
      data: {
        scoringStrategyId,
        fromVersion: snapshot.version,
        toVersion: snapshot.version,
        summary: `Restored to version ${snapshot.version}`,
        details: { restoredFrom: snapshotId, restoredAt: new Date().toISOString() },
        author: 'restore',
      },
    });

    this.logger.log(`Strategy ${scoringStrategyId} restored to version ${snapshot.version}`);
    return { restored: true, version: snapshot.version };
  }

  /** Export a snapshot as JSON */
  async exportSnapshot(scoringStrategyId: string, snapshotId: string) {
    const snapshot = await this.prisma.metaStackSnapshot.findFirst({
      where: { id: snapshotId, scoringStrategyId },
    });
    if (!snapshot) throw new NotFoundException(`Snapshot ${snapshotId} not found`);
    return {
      metaStackId: scoringStrategyId,
      version: snapshot.version,
      fingerprint: snapshot.fingerprint,
      createdAt: snapshot.createdAt,
      snapshot: snapshot.snapshot,
    };
  }

  /** Get fingerprint of current strategy state for comparison */
  async getCurrentFingerprint(scoringStrategyId: string): Promise<string> {
    const strategy = await this.prisma.scoringStrategy.findUnique({
      where: { id: scoringStrategyId },
      include: { protocolLinks: true },
    });
    if (!strategy) throw new NotFoundException(`Strategy ${scoringStrategyId} not found`);
    const data = { ...strategy, protocolLinks: strategy.protocolLinks?.map(p => ({ protocolSlug: p.protocolSlug, role: p.role, sortOrder: p.sortOrder })) || [] };
    return this.hashSnapshot(data);
  }

  /** Get latest snapshot fingerprint for comparison */
  async getLatestFingerprint(scoringStrategyId: string): Promise<string | null> {
    const latest = await this.prisma.metaStackSnapshot.findFirst({
      where: { scoringStrategyId },
      orderBy: { createdAt: 'desc' },
      select: { fingerprint: true },
    });
    return latest?.fingerprint || null;
  }

  // ── Helpers ──

  private bumpVersion(current: string): string {
    const parts = current.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1; // bump patch
    if (parts[2] >= 100) { parts[2] = 0; parts[1] = (parts[1] || 0) + 1; } // roll minor
    if (parts[1] >= 100) { parts[1] = 0; parts[0] = (parts[0] || 1) + 1; } // roll major
    return parts.join('.');
  }

  private hashSnapshot(data: any): string {
    const json = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(json).digest('hex').substring(0, 64);
  }
}
