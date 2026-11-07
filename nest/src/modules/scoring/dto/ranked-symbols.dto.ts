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
