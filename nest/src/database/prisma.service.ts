import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const DB_RETRIES = 3;
const DB_RETRY_DELAY_MS = 1500;

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

    // Retry loop for MySQL connection
    for (let attempt = 1; attempt <= DB_RETRIES; attempt++) {
      try {
        await this.$connect();
        await this.$queryRaw`SELECT 1`;
        this._isAvailable = true;
        this.logger.log(
          `Prisma connected to MySQL and verified (attempt ${attempt}).`,
        );
        return;
      } catch (error) {
        if (attempt < DB_RETRIES) {
          this.logger.warn(
            `Prisma connection attempt ${attempt}/${DB_RETRIES} failed. Retrying in ${DB_RETRY_DELAY_MS}ms...`,
          );
          await new Promise((r) => setTimeout(r, DB_RETRY_DELAY_MS));
        } else {
          this.logger.warn(
            `Prisma connection failed after ${DB_RETRIES} attempts: ${String(error)}. ` +
            'App running in degraded mode. Start MySQL (WAMP/XAMPP) and restart the backend.',
          );
          this._isAvailable = false;
        }
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
