import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private _isAvailable = false;

  constructor() {
    super();
  }

  get isAvailable(): boolean {
    return this._isAvailable;
  }

  async onModuleInit(): Promise<void> {
    if (!process.env.DATABASE_URL) {
      this.logger.warn(
        'DATABASE_URL not set — Prisma will operate in no-connection mode.',
      );
      this._isAvailable = false;
      return;
    }

    try {
      await this.$connect();
      await this.$queryRaw`SELECT 1`;
      this._isAvailable = true;
      this.logger.log('Prisma connected to MySQL and verified.');
    } catch (error) {
      this.logger.warn(
        `Prisma connection or verification failed: ${String(error)}. Operating in no-connection mode.`,
      );
      this._isAvailable = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
