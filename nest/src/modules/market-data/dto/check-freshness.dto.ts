import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CheckFreshnessDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  timeframe = '1h';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10080)
  maxAgeMinutes = 60;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) {
      return true;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    return String(value).toLowerCase() !== 'false';
  })
  @IsBoolean()
  queueIfStale = true;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  provider = 'alpaca';
}
