import { Controller, Get, Post, Query } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Controller('capabilities')
export class CapabilityController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async getAll(@Query('category') category?: string, @Query('area') area?: string) {
    let sql = 'SELECT * FROM capability WHERE 1=1';
    const params: any[] = [];
    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (area) { sql += ' AND area = ?'; params.push(area); }
    sql += ' ORDER BY category, name';
    return (this.prisma as any).$queryRawUnsafe(sql, ...params);
  }

  @Post()
  async add(
    @Query('name') name: string,
    @Query('category') category: string,
    @Query('area') area: string,
    @Query('type') type: string,
    @Query('status') status: string,
    @Query('notes') notes?: string,
    @Query('dataPersistence') dataPersistence?: string,
    @Query('uiSurfaces') uiSurfaces?: string,
    @Query('pipelineIntegration') pipelineIntegration?: string,
    @Query('devCompletion') devCompletion?: string,
  ) {
    const id = require('crypto').randomUUID();
    await (this.prisma as any).$queryRawUnsafe(
      `INSERT INTO capability (id, name, category, area, type, status, notes, dataPersistence, uiSurfaces, pipelineIntegration, devCompletion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, name, category || 'General', area || 'Backend', type || 'Service',
      status || 'ALPHA', notes || null, dataPersistence || 'ephemeral',
      uiSurfaces ? parseInt(uiSurfaces) : 0, pipelineIntegration || 'none', devCompletion || 'partial'
    );
    return { id, name, status: 'created' };
  }
}
