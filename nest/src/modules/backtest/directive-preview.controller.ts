/**
 * DirectivePreviewController — the Lab's chart needs a picture, not a run.
 *
 * ⚠️ A SEPARATE CONTROLLER FROM `BacktestController` ON PURPOSE, under its own prefix. Everything on
 * `/api/backtest/*` is a RUN: it stores a `backtestrun` row, it is subject to the frozen-window and
 * coverage guards, and it appears in Completed Runs. A settings drag on a chart must do none of those —
 * storing a row per slider movement would bury the real runs in minutes. So this route is a projection:
 * it reads bars and returns what the directive would SEE. Nothing is written.
 *
 * It still lives in the backtest module because it is the Lab's tool and it reads the same bars.
 */
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DirectivePreviewService } from './directive-preview.service';

@ApiTags('backtest')
@Controller('backtest/directive-preview')
export class DirectivePreviewController {
  constructor(private readonly preview: DirectivePreviewService) {}

  @Post()
  @ApiOperation({
    summary: 'Preview one directive over a window: bars, indicator series, pivots and divergences',
    description:
      'Read-only. Returns the bars, the indicator series aligned to them, every swing pivot found, every '
      + 'divergence pair of all four kinds, and the per-bar score the directive would produce. The response '
      + 'carries `scope.honouredInScoring` vs `scope.previewOnly`, because some source-indicator knobs are '
      + 'not yet read by the scorer — a chart drawn with them previews what the detector COULD see, not what '
      + 'a run will use. Supported directive: `rsi-divergence`. An unsupported id is a 400, never an empty chart.',
  })
  async run(
    @Body() body: {
      symbol: string;
      timeframe: string;
      directiveId: string;
      days?: number;
      periodId?: string;
      params?: Record<string, unknown>;
    },
  ) {
    return this.preview.preview({
      symbol: body?.symbol,
      timeframe: body?.timeframe ?? '1h',
      directiveId: body?.directiveId,
      days: body?.days,
      periodId: body?.periodId,
      params: body?.params as any,
    });
  }
}
