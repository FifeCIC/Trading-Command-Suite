/**
 * Preferences Controller — DB-backed user preferences + feature flags.
 *
 * Uses existing UserPreferences table (key-value per user).
 * Feature flags use the new FeatureFlag table.
 */

import { Controller, Get, Put, Param, Body, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const USER_ID = 'default';

@Controller()
export class PreferencesController {
  private readonly logger = new Logger(PreferencesController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('preferences')
  async getPrefs() {
    if (!this.prisma.isAvailable) return {};
    const rows = await this.prisma.userPreferences.findMany({ where: { userId: USER_ID } });
    const map: Record<string, any> = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  }

  @Put('preferences')
  async updatePref(@Body() body: { key: string; value: any }) {
    if (!this.prisma.isAvailable) return { error: 'DB unavailable' };
    await this.prisma.userPreferences.upsert({
      where: { userId_key: { userId: USER_ID, key: body.key } },
      update: { value: body.value },
      create: { userId: USER_ID, key: body.key, value: body.value },
    });
    return { saved: true, key: body.key };
  }

  @Get('feature-flags')
  async getFlags() {
    if (!this.prisma.isAvailable) return [];
    return this.prisma.featureFlag.findMany({ orderBy: { id: 'asc' } });
  }

  @Put('feature-flags/:id')
  async toggleFlag(@Param('id') id: string, @Body() body: { enabled: boolean; description?: string }) {
    if (!this.prisma.isAvailable) return { error: 'DB unavailable' };
    await this.prisma.featureFlag.upsert({
      where: { id },
      update: { enabled: body.enabled, ...(body.description !== undefined && { description: body.description }) },
      create: { id, enabled: body.enabled, description: body.description || '' },
    });
    return { id, enabled: body.enabled };
  }
}
