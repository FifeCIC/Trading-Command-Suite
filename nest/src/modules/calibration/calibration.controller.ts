import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { CalibrationService } from './calibration.service';
import type { CalibrationEntry } from './calibration.service';

class UpsertCalibrationDto {
  symbol!: string;
  directiveId!: string;
  weightMultiplier!: number;
  reason!: string;
  decayModifier?: number | null;
  volatilityAdjustment?: number | null;
}

@Controller('api/calibrations')
export class CalibrationController {
  constructor(private readonly calibrationService: CalibrationService) {}

  @Get()
  async getAll() {
    return this.calibrationService.getAllCalibrations();
  }

  @Get(':symbol')
  async getForSymbol(@Param('symbol') symbol: string) {
    return this.calibrationService.getSymbolOverrides(symbol);
  }

  @Post()
  async upsert(@Body() entry: UpsertCalibrationDto) {
    await this.calibrationService.upsertCalibration(entry);
    return { success: true, entry };
  }

  @Delete(':symbol/:directiveId')
  async delete(
    @Param('symbol') symbol: string,
    @Param('directiveId') directiveId: string,
  ) {
    await this.calibrationService.deleteCalibration(symbol, directiveId);
    return { success: true };
  }

  @Post('reload')
  async reload() {
    await this.calibrationService.loadCalibrations();
    return { success: true, message: 'Calibrations reloaded from database' };
  }
}
