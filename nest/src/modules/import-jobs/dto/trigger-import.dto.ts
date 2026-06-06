import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TriggerImportDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  timeframe = '1h';

  @IsOptional()
  @IsString()
  @MaxLength(50)
  provider = 'alpaca';

  @IsOptional()
  @IsString()
  @MaxLength(50)
  source = 'manual-trigger';
}
