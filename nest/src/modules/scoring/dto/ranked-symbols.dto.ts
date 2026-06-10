/**
 * PLACEHOLDER — implement per SPRINT.md Task 6.
 *
 * Ranked Symbols DTO
 * ==================
 * Response shape for the GET /api/scoring/ranked endpoint.
 */

import { ApiProperty } from '@nestjs/swagger';

export class RankedSymbolDto {
  @ApiProperty({ example: 'uuid-of-symbol' })
  symbolId!: string;

  @ApiProperty({ example: 'AAPL' })
  ticker!: string;

  @ApiProperty({ example: 72.5 })
  score!: number;

  @ApiProperty({ example: 0.85 })
  confidence!: number;

  @ApiProperty({ example: 'stale' })
  freshness!: string;

  @ApiProperty({ example: '2026-06-09T14:00:00Z' })
  timestamp!: string;
}
