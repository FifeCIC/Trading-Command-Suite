/**
 * ScoringStrategyController — API for scoring strategies.
 * ========================================================
 * Scoring strategies define HOW a protocol's scores are used:
 * which groups gate, at what threshold, and weighting.
 *
 * POST /api/scoring/strategies   — create or update
 * GET  /api/scoring/strategies   — list all
 * GET  /api/scoring/strategies/:id — get one
 */
import { Controller, Get, Post, Patch, Param, Body, Logger } from '@nestjs/common';
import { ScoringStrategyService, CreateScoringStrategyDto } from './scoring-strategy.service';

@Controller('scoring/strategies')
export class ScoringStrategyController {
  private readonly logger = new Logger(ScoringStrategyController.name);

  constructor(private readonly service: ScoringStrategyService) {}

  @Get()
  async findAll() {
    return { strategies: await this.service.findAll() };
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  async create(@Body() dto: CreateScoringStrategyDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<CreateScoringStrategyDto>) {
    return this.service.update(id, dto);
  }
}
