import { Controller, Get, Post, Param, Query, Body, Logger } from '@nestjs/common';
import { InvestigationService } from './investigation.service';

@Controller('research/investigations')
export class InvestigationController {
  private readonly logger = new Logger(InvestigationController.name);

  constructor(private readonly investigationService: InvestigationService) {}

  @Post()
  async create(@Body() body: { symbol: string; trigger?: string }) {
    return this.investigationService.investigate(
      body.symbol,
      body.trigger || 'manual',
    );
  }

  @Get()
  async findAll(@Query('symbol') symbol?: string, @Query('limit') limit?: string) {
    return this.investigationService.findAll(symbol, limit ? parseInt(limit) : 20);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.investigationService.findOne(id);
  }

  @Post(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; outcome?: string },
  ) {
    return this.investigationService.updateStatus(id, body.status, body.outcome);
  }
}
