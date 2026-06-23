/**
 * SpeedScanController — endpoint for the Speed Trading "Best Symbol" scanner.
 *
 * POST /api/speed/scan
 */
import { Controller, Post, Body, Logger } from '@nestjs/common';
import { IsOptional, IsArray, IsString } from 'class-validator';
import { SpeedScanService } from './speed-scan.service';

class ScanRequestDto {
  @IsOptional() @IsArray() @IsString({ each: true }) symbols?: string[];
  @IsOptional() @IsString() timeframe?: string;
}

@Controller('speed')
export class SpeedScanController {
  private readonly logger = new Logger(SpeedScanController.name);

  constructor(private readonly speedScan: SpeedScanService) {}

  @Post('scan')
  async scan(@Body() body: ScanRequestDto) {
    return this.speedScan.scan(body.symbols, body.timeframe);
  }
}
