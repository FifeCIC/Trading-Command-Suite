import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Body for POST /api/signals/:id/trade — manual trade action.
 * `side` is required; everything else falls back to the signal's own data
 * and safe defaults.
 */
export class ManualTradeDto {
  @IsIn(['BUY', 'SELL'])
  side: 'BUY' | 'SELL';

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  protocolId?: string;

  @IsOptional()
  @IsString()
  brokerId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  @Max(100)
  size?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  slPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  tpPct?: number;
}
