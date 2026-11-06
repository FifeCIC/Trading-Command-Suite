import { Controller, Get } from '@nestjs/common';
import { ExperimentReviewService } from './experiment-review.service';

/**
 * GET /api/automation/experiments — every live comparison, with the action to take.
 *
 * ⚠️ ONE ENDPOINT, THREE CONSUMERS, ONE RULE. The Strategies view panel, the CLI
 * (`scripts/report-experiments.cjs`) and an agent all read this. A second implementation for any of
 * them would drift at the first change to the rule — which is the debt `verdict-bar.ts` exists to
 * avoid.
 *
 * ⚠️ READ-ONLY ON PURPOSE. There is no "kill experiment" POST here: closing a test destroys the
 * record of what was tried, so it stays a deliberate human/agent action rather than a button that
 * a page refresh could fire.
 */
@Controller('automation/experiments')
export class ExperimentReviewController {
  constructor(private readonly review: ExperimentReviewService) {}

  @Get()
  async list() {
    return this.review.listExperiments();
  }
}
