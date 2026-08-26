import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Body for POST /api/signals/dismiss (#684) — hide a signal for N hours.
 * Keyed on symbol + protocolId; `hours` defaults to 1 server-side.
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
}
