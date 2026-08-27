import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * BrokerConfigService — persisted broker capabilities.
 *
 * Replaces the hardcoded PROTOCOL_BROKER_MAP that was duplicated across
 * StrategyCreatePage.jsx.
 *
 * On module init, seeds the broker_config table with default values if empty.
 */
@Injectable()
export class BrokerConfigService implements OnModuleInit {
  private readonly logger = new Logger(BrokerConfigService.name);

  /** Default broker configs — match the old PROTOCOL_BROKER_MAP */
  private static readonly DEFAULTS = [
    {
      id: 'mt5',
      displayName: 'MetaTrader 5',
      supportedStyles: ['scalp', 'day-trade', 'swing', 'position', 'speed'],
      supportedAssetTypes: ['forex', 'commodity', 'index', 'crypto', 'stock'],
      tradingEnabled: true,
      note: 'Full execution — SL/TP, trailing stops, partial close',
      sortOrder: 0,
    },
    {
      id: 'trading212',
      displayName: 'Trading 212',
      supportedStyles: ['swing', 'position'],
      supportedAssetTypes: ['stock', 'etf'],
      tradingEnabled: false,
      note: 'Portfolio monitoring only — no trade execution',
      sortOrder: 1,
    },
    {
      id: 'paper',
      displayName: 'Paper Trading',
      supportedStyles: ['scalp', 'day-trade', 'swing', 'position', 'speed'],
      supportedAssetTypes: ['forex', 'commodity', 'index', 'crypto', 'stock', 'etf'],
      tradingEnabled: true,
      note: 'Virtual ledger — ideal for testing new strategies',
      sortOrder: 2,
    },
    {
      id: 'capital.com',
      displayName: 'Capital.com',
      supportedStyles: ['scalp', 'day-trade', 'swing', 'position'],
      supportedAssetTypes: ['forex', 'commodity', 'index', 'crypto'],
      tradingEnabled: true,
      note: 'CFD broker — session-based auth, demo + live accounts',
      sortOrder: 3,
    },
  ];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  /** Idempotent seed — inserts defaults if table is empty. */
  private async seedDefaults(): Promise<void> {
    try {
      if (!this.prisma.isAvailable) return;
      const count = await (this.prisma as any).brokerConfig.count();
      if (count > 0) return;

      for (const cfg of BrokerConfigService.DEFAULTS) {
        await (this.prisma as any).brokerConfig.create({ data: { ...cfg, isActive: true } });
      }
      this.logger.log(`Seeded ${BrokerConfigService.DEFAULTS.length} broker configs`);
    } catch (err) {
      this.logger.warn(`Broker config seed skipped: ${(err as Error).message}`);
    }
  }

  /** Get all broker configs, ordered by sortOrder. */
  async findAll(): Promise<any[]> {
    try {
      if (!this.prisma.isAvailable) return BrokerConfigService.DEFAULTS.map(c => ({ ...c, isActive: true }));
      return (this.prisma as any).brokerConfig.findMany({ orderBy: { sortOrder: 'asc' } });
    } catch {
      return BrokerConfigService.DEFAULTS.map(c => ({ ...c, isActive: true }));
    }
  }

  /** Get a single broker config by id. */
  async findOne(brokerId: string): Promise<any | null> {
    try {
      if (!this.prisma.isAvailable) return BrokerConfigService.DEFAULTS.find(c => c.id === brokerId) ?? null;
      return (this.prisma as any).brokerConfig.findUnique({ where: { id: brokerId } });
    } catch {
      return BrokerConfigService.DEFAULTS.find(c => c.id === brokerId) ?? null;
    }
  }

  /** Check if a broker supports a given trading style and asset type. */
  async isCompatible(brokerId: string, style: string, assetType: string): Promise<boolean> {
    const cfg = await this.findOne(brokerId);
    if (!cfg) return false;
    const styles: string[] = cfg.supportedStyles ?? [];
    const types: string[] = cfg.supportedAssetTypes ?? [];
    return styles.includes(style) && types.includes(assetType);
  }
}
