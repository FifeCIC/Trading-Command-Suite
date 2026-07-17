import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

export interface AppSettings {
  earnings: { importHorizonMonths: number; autoRefreshDays: number };
  correlation: { refreshMinutes: number; warningThreshold: number };
  seasonality: { weightMultiplier: number };
  analyst: { refreshHours: number };
  data: { stalenessHours: number };
}

const DEFAULTS: AppSettings = {
  earnings: { importHorizonMonths: 3, autoRefreshDays: 7 },
  correlation: { refreshMinutes: 360, warningThreshold: 0.7 },
  seasonality: { weightMultiplier: 1.0 },
  analyst: { refreshHours: 24 },
  data: { stalenessHours: 24 },
};

const SETTING_KEY = 'app';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly filePath = path.join(process.cwd(), 'app-settings.json');

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AppSettings> {
    try {
      if (this.prisma.isAvailable) {
        const row = await this.prisma.appSetting.findUnique({ where: { id: SETTING_KEY } });
        if (row) return { ...DEFAULTS, ...(row.value as any) };
      }
    } catch (err) {
      this.logger.warn(`DB settings read failed: ${(err as Error).message}`);
    }
    // Fallback: read from legacy JSON file, then migrate to DB
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = { ...DEFAULTS, ...JSON.parse(raw) };
        await this.saveToDb(data).catch(() => {});
        return data;
      }
    } catch {}
    return { ...DEFAULTS };
  }

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    const merged = this.deepMerge(current, partial);
    await this.saveToDb(merged);
    try { fs.writeFileSync(this.filePath, JSON.stringify(merged, null, 2)); } catch {}
    this.logger.log('Settings updated');
    return merged;
  }

  async reset(): Promise<AppSettings> {
    try { if (this.prisma.isAvailable) await this.prisma.appSetting.delete({ where: { id: SETTING_KEY } }).catch(() => {}); } catch {}
    try { if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath); } catch {}
    return { ...DEFAULTS };
  }

  private async saveToDb(data: AppSettings): Promise<void> {
    if (!this.prisma.isAvailable) return;
    await this.prisma.appSetting.upsert({
      where: { id: SETTING_KEY },
      update: { value: data as any },
      create: { id: SETTING_KEY, value: data as any },
    });
  }

  private deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target };
    for (const key of Object.keys(source) as (keyof T)[]) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] as any, source[key] as any);
      } else if (source[key] !== undefined) {
        result[key] = source[key] as any;
      }
    }
    return result;
  }
}
