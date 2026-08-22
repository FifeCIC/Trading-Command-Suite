import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * PUT /api/research/earnings/settings body.
 * All fields optional — only provided fields are patched.
 * (Whitelist pipe strips anything NOT declared here — see
 *  /memories/repo/nestjs-backend-architecture.md validation gotcha.)
 */
export class EarningsImportSettingsDto {
  @IsOptional()
  @IsBoolean()
  autoImportEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  horizonMonths?: number;

  @IsOptional()
  @IsIn(['all', 'watchlist', 'portfolio'])
  scope?: 'all' | 'watchlist' | 'portfolio';

  @IsOptional()
  @IsNumber()
  @Min(0)
  minMarketCap?: number;

  @IsOptional()
  @IsIn(['all', 'bmo', 'amc'])
  timeOfDay?: 'all' | 'bmo' | 'amc';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  sources?: string[];

  @IsOptional()
  @IsString()
  @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/, { message: 'scheduleTime must be HH:MM (24h)' })
  scheduleTime?: string;

  @IsOptional()
  @IsIn(['daily', 'weekdays'])
  scheduleDays?: 'daily' | 'weekdays';

  @IsOptional()
  @IsBoolean()
  requireKnownSession?: boolean;
}
