/* ── PLANNED IN #1228 ──
 * MISSING:  reachability. Nothing in src/ or nest/src/ names this file — no import, no route,
 *           no dynamic load. Either it is dead code, or it is a capability nobody wired up, and
 *           those two need opposite responses.
 * TODAY:    found by the name-reference scan in scripts/audit-code-health.cjs (see
 *           docs/CODE-HEALTH.md). Decide DELETE / WIRE UP / KEEP+explain, record it on the
 *           issue, then re-bank: node scripts/audit-code-health.cjs --write
 * WHEN BUILT: the file is either gone, or reachable and named by something.
 * CODE-HEALTH-MARKER — written by scripts/audit-code-health.cjs; re-run it rather than editing.
 */

/**
 * PLACEHOLDER — implement per SPRINT.md Task 5.
 *
 * Score Breakdown DTO
 * ===================
 * Response shape for the strategy score breakdown endpoint.
 */

import { ApiProperty } from '@nestjs/swagger';

export class ScoreBreakdownItemDto {
  @ApiProperty({ example: 'rsi-oversold' })
  directiveId!: string;

  @ApiProperty({ example: 'RSI Oversold Reversion' })
  name!: string;

  @ApiProperty({ example: 72.5 })
  rawScore!: number;

  @ApiProperty({ example: 25 })
  weight!: number;

  @ApiProperty({ example: 18.125 })
  contribution!: number;
}

export class StrategyScoreDto {
  @ApiProperty({ example: 'strat-001' })
  strategyId!: string;

  @ApiProperty({ example: 'Conservative Long' })
  strategyName!: string;

  @ApiProperty({ example: 'uuid-of-symbol' })
  symbolId!: string;

  @ApiProperty({ example: 64.5 })
  totalScore!: number;

  @ApiProperty({ example: 0.82 })
  confidence!: number;

  @ApiProperty({ type: [ScoreBreakdownItemDto] })
  breakdown!: ScoreBreakdownItemDto[];

  @ApiProperty({ example: '1h' })
  timeframe!: string;

  @ApiProperty({ example: 'Moderate buy signal — 1h timeframe.' })
  guidance!: string;

  @ApiProperty({ example: '2026-06-09T14:00:00Z' })
  timestamp!: string;
}
