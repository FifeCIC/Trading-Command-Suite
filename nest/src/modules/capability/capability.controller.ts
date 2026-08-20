import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateCapabilityDto } from './dto/create-capability.dto';

/**
 * Capability Map CRUD — typed Prisma, body DTO.
 * The capability table is the single source of truth for capability metadata;
 * the Librarian workflow POSTs here instead of editing frontend literals.
 * POST is an upsert by name so repeated handoff batches are idempotent.
 */
@Controller('capabilities')
export class CapabilityController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async getAll(@Query('category') category?: string, @Query('area') area?: string) {
    return this.prisma.capability.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(area ? { area } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  @Post()
  async add(@Body() dto: CreateCapabilityDto) {
    const data = {
      name: dto.name,
      category: dto.category ?? 'General',
      area: dto.area ?? 'Backend',
      type: dto.type ?? 'Service',
      status: dto.status ?? 'ALPHA',
      notes: dto.notes ?? null,
      dataPersistence: dto.dataPersistence ?? 'ephemeral',
      uiSurfaces: dto.uiSurfaces ?? 0,
      pipelineIntegration: dto.pipelineIntegration ?? 'none',
      devCompletion: dto.devCompletion ?? 'partial',
    };

    const existing = await this.prisma.capability.findFirst({
      where: { name: dto.name },
      select: { id: true },
    });
    if (existing) {
      const updated = await this.prisma.capability.update({
        where: { id: existing.id },
        data,
      });
      return { id: updated.id, name: updated.name, status: 'updated' };
    }

    const created = await this.prisma.capability.create({ data });
    return { id: created.id, name: created.name, status: 'created' };
  }
}
