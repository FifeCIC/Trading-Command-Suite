import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Logger } from '@nestjs/common';
import { PlannerService } from './planner.service';

@Controller('planner')
export class PlannerController {
  private readonly logger = new Logger(PlannerController.name);

  constructor(private readonly planner: PlannerService) {}

  // ── Fund Allocations ────────────────────────────────────

  @Get('allocations')
  async getAllocations() {
    return this.planner.getFundAllocations();
  }

  @Post('allocations')
  async createAllocation(@Body() body: any) {
    return this.planner.createFundAllocation(body);
  }

  @Patch('allocations/:id')
  async updateAllocation(@Param('id') id: string, @Body() body: any) {
    return this.planner.updateFundAllocation(id, body);
  }

  @Delete('allocations/:id')
  async deleteAllocation(@Param('id') id: string) {
    return this.planner.deleteFundAllocation(id);
  }

  // ── Trading Styles ──────────────────────────────────────

  @Get('styles')
  async getStyles() {
    return this.planner.getTradingStyles();
  }

  @Post('styles/seed')
  async seedStyles() {
    return this.planner.seedDefaultStyles();
  }

  @Patch('styles/:styleKey/toggle')
  async toggleStyle(@Param('styleKey') styleKey: string, @Body() body: { enabled: boolean }) {
    return this.planner.toggleTradingStyle(styleKey, body.enabled);
  }

  // ── Trading Objectives ──────────────────────────────────

  @Get('objectives')
  async getObjectives(@Query('status') status?: string) {
    return this.planner.getObjectives(status);
  }

  @Post('objectives')
  async createObjective(@Body() body: any) {
    return this.planner.createObjective(body);
  }

  @Post('objectives/seed')
  async seedObjectives() {
    return this.planner.seedBuiltInObjectives();
  }

  @Patch('objectives/:id')
  async updateObjective(@Param('id') id: string, @Body() body: any) {
    return this.planner.updateObjective(id, body);
  }

  @Delete('objectives/:id')
  async deleteObjective(@Param('id') id: string) {
    return this.planner.deleteObjective(id);
  }
}
