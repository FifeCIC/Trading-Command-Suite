/**
 * FaultsController — the registry's HTTP surface.
 *
 * ⚠️ WHY THERE IS A `POST /record` AT ALL, given the service can be injected: the audit and canary
 * scripts under `scripts/` and `nest/scripts/` are plain Node CJS. They cannot inject a Nest
 * service, so without this endpoint every one of them would either duplicate the upsert in raw SQL
 * (a second write path that drifts — the exact defect `shared-core.instructions.md` forbids) or
 * write nothing at all. One endpoint, one write path, and the code-shape validation applies to
 * script writers for free.
 *
 * ⚠️ THERE IS NO DELETE ROUTE, and that is the point (G2, `docs/FAULT-TAXONOMY-GUARDRAILS.md`).
 * A fault row is RETIRED. If you are here to add a delete, read that file first: deleting a code
 * when its issue closes destroys the evidence that it ever happened, and the next occurrence looks
 * brand new.
 */
import { Controller, Get, Post, Param, Body, Query, BadRequestException } from '@nestjs/common';
import {
  FaultsService,
  FAULT_AREAS,
  FAULT_STATUSES,
  type FaultArea,
  type FaultObservation,
  type FaultStatus,
} from './faults.service';

@Controller('faults')
export class FaultsController {
  constructor(private readonly faults: FaultsService) {}

  /**
   * GET /api/faults?status=open&area=bridge&staleDays=14
   * `staleDays` returns the NEGLECTED set, and the response says which threshold was applied —
   * a filtered list that does not state its filter is a list whose emptiness means nothing.
   */
  @Get()
  async list(
    @Query('status') status?: string,
    @Query('area') area?: string,
    @Query('staleDays') staleDays?: string,
  ) {
    if (status && !FAULT_STATUSES.includes(status as FaultStatus)) {
      throw new BadRequestException(`status must be one of ${FAULT_STATUSES.join(', ')}`);
    }
    if (area && !FAULT_AREAS.includes(area as FaultArea)) {
      throw new BadRequestException(`area must be one of ${FAULT_AREAS.join(', ')}`);
    }
    const days = staleDays === undefined ? undefined : Number(staleDays);
    if (days !== undefined && !Number.isFinite(days)) {
      throw new BadRequestException('staleDays must be a number');
    }
    return this.faults.list({ status: status as FaultStatus | undefined, area: area as FaultArea | undefined, staleDays: days });
  }

  /** GET /api/faults/summary?staleDays=14 — is the registry being maintained, as counts. */
  @Get('summary')
  summary(@Query('staleDays') staleDays?: string) {
    const days = staleDays === undefined ? 14 : Number(staleDays);
    if (!Number.isFinite(days)) throw new BadRequestException('staleDays must be a number');
    return this.faults.summary(days);
  }

  /** POST /api/faults/record — used by audit/canary scripts, which cannot inject the service. */
  @Post('record')
  record(@Body() body: FaultObservation) {
    return this.faults.record(body);
  }

  /** POST /api/faults/:code/review — the cadence beat. Records that somebody looked. */
  @Post(':code/review')
  review(@Param('code') code: string, @Body() body: { reviewedBy: string; note?: string; issueUrl?: string }) {
    if (!body?.reviewedBy) throw new BadRequestException('reviewedBy is required — an unattributed review is not a review');
    return this.faults.review(code, body.reviewedBy, body.note, body.issueUrl);
  }

  /** POST /api/faults/:code/acknowledge — seen and understood, still happening. */
  @Post(':code/acknowledge')
  acknowledge(@Param('code') code: string, @Body() body: { reviewedBy: string; note?: string; issueUrl?: string }) {
    if (!body?.reviewedBy) throw new BadRequestException('reviewedBy is required');
    return this.faults.acknowledge(code, body.reviewedBy, body.note, body.issueUrl);
  }

  /**
   * POST /api/faults/:code/retire — the only exit path. The row and its count stay.
   * `issueUrl` is optional here too: a fault retired because its issue was fixed should point at it.
   */
  @Post(':code/retire')
  retire(@Param('code') code: string, @Body() body: { reviewedBy: string; note?: string; issueUrl?: string }) {
    if (!body?.reviewedBy) throw new BadRequestException('reviewedBy is required');
    return this.faults.retire(code, body.reviewedBy, body.note, body.issueUrl);
  }
}
