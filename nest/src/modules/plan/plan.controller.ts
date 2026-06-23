import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Logger } from '@nestjs/common';
import { PlanService } from './plan.service';

@Controller('plans')
export class PlanController {
  private readonly logger = new Logger(PlanController.name);

  constructor(private readonly planService: PlanService) {}

  @Get()
  async list(@Query('status') status?: string) {
    return this.planService.findAll(status);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.planService.findOne(id);
  }

  @Post()
  async create(
    @Body()
    body: {
      title: string;
      type?: string;
      content: unknown;
      notes?: string;
      status?: string;
      symbols?: string[];
    },
  ) {
    this.logger.log(`Creating plan: ${body.title}`);
    return this.planService.create(body);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      content?: unknown;
      notes?: string;
      status?: string;
      symbols?: string[];
    },
  ) {
    return this.planService.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.planService.remove(id);
  }

  // ── Plan Steps ──────────────────────────────────────────

  @Post(':planId/steps')
  async addStep(
    @Param('planId') planId: string,
    @Body()
    body: {
      action: string;
      symbol: string;
      quantity?: number;
      targetPrice?: number;
      stopLoss?: number;
      deadline?: string;
      conditions?: string;
      notes?: string;
    },
  ) {
    return this.planService.addStep(planId, body);
  }

  @Patch(':planId/steps/:stepId')
  async updateStep(
    @Param('stepId') stepId: string,
    @Body()
    body: {
      status?: string;
      executedPrice?: number;
      notes?: string;
      sortOrder?: number;
    },
  ) {
    return this.planService.updateStep(stepId, body);
  }

  @Delete(':planId/steps/:stepId')
  async removeStep(@Param('stepId') stepId: string) {
    return this.planService.removeStep(stepId);
  }
}
