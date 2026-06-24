import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const SYMBOL_TYPES = ['stock', 'crypto', 'forex', 'index', 'commodity', 'etf'] as const;

export class CreateSymbolDto {
  @ApiProperty({ example: 'AAPL' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  ticker!: string;

  @ApiProperty({ example: 'Apple Inc.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'NASDAQ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  exchange!: string;

  @ApiProperty({ enum: SYMBOL_TYPES, example: 'stock' })
  @IsString()
  @IsIn(SYMBOL_TYPES)
  type!: (typeof SYMBOL_TYPES)[number];

  @ApiPropertyOptional({ description: 'JSON array of tags', example: '["speed-trading","xtrend"]' })
  @IsOptional()
  tags?: any;

  @ApiPropertyOptional({ description: 'Provider-specific ticker aliases', example: '{"mt5":"BIXI","yahoo":"BTC-USD"}' })
  @IsOptional()
  aliases?: any;
}
