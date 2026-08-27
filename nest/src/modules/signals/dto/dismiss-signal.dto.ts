import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Body for POST /api/signals/dismiss (#684) — hide a signal for N hours.
 * Keyed on symbol + protocolId; `hours` defaults to 1 server-side.
 *
 * Strength fields (#693) are optional snapshots of what the user saw at
 * dismissal time — stored for the Signals feedback loop's dismissal
 * analytics and threshold calibration.
 */
export class DismissSignalDto {
  @IsString()
  symbol: string;

  @IsOptional()
  @IsString()
  protocolId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  hours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  combinedStrength?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  signalPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  opportunityPct?: number;
}
