/**
 * Automation Rules Controller — DB-backed global safety rules.
 *
 * GET  /api/automation/rules       — list all rules
 * PUT  /api/automation/rules/:id   — update a rule (enabled, config)
 */

import { Controller, Get, Put, Param, Body, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Controller('automation/rules')
export class AutomationRulesController {
  private readonly logger = new Logger(AutomationRulesController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    if (!this.prisma.isAvailable) return [];
    return this.prisma.automationRule.findMany({ orderBy: { id: 'asc' } });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: { enabled?: boolean; config?: any; name?: string; description?: string }) {
    if (!this.prisma.isAvailable) return { error: 'DB unavailable' };
    const data: any = {};
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.config !== undefined) data.config = body.config;
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;

    await this.prisma.automationRule.upsert({
      where: { id },
      update: data,
      create: { id, name: body.name || id, description: body.description || '', config: body.config || {}, enabled: body.enabled ?? false },
    });
    return { id, ...data };
  }
}
