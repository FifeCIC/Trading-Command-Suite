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
        await this.bootstrapSchema();
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

  /**
   * One-time schema bootstrapping for additive tables that prisma db push
   * can't safely create (e.g. due to pre-existing table conflicts like
   * automation_rule). Uses CREATE TABLE IF NOT EXISTS — safe to run on
   * every startup. Only called once in onModuleInit after DB is verified.
   *
   * Additive-only — never drops or alters existing tables.
   */
  private async bootstrapSchema(): Promise<void> {
    const tables = [
      // Unified Job Queue (#614) — created here so `prisma db push` never
      // needs to touch pre-existing tables. Additive-only, safe every boot.
      `CREATE TABLE IF NOT EXISTS scheduled_job (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'queued',
        priority INT NOT NULL DEFAULT 50,
        runAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        recurrence VARCHAR(20) NULL,
        recurrenceMs INT NULL,
        payload JSON NULL,
        attempts INT NOT NULL DEFAULT 0,
        maxAttempts INT NOT NULL DEFAULT 3,
        lastRunAt DATETIME(3) NULL,
        lastError TEXT NULL,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX idx_scheduled_job_status_runAt (status, runAt),
        INDEX idx_scheduled_job_type (type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ];

    for (const sql of tables) {
      try {
        await this.$executeRawUnsafe(sql);
      } catch (err) {
        this.logger.warn(`Schema bootstrap failed: ${(err as Error).message}`);
      }
    }
  }
}
