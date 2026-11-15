import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  SUPPORTER_KINDS,
  SUPPORTER_RESPONSES,
  SupporterService,
  SupporterStatus,
} from './supporter.service';

/**
 * SupporterController — the two endpoints the in-app support prompt needs (#1147 §2.2, §2.3).
 *
 * WHY THE DECISION IS MADE SERVER-SIDE
 * -----------------------------------
 * `GET /status` returns the verdict, not the inputs. If the frontend were handed the raw facts
 * (enabled, cadence, last shown, days active) it would re-implement the comparison, and then two
 * definitions of "how often may we ask" would exist — one of which would silently win. The same
 * reason `#1147` §2.3 insists the profit figure come from `GET /api/scoring/edge/pnl` rather than a
 * re-derivation.
 *
 * ⚠️ THE ANSWER IS `eligible: false` ON EVERY FAILURE PATH, including an unreadable database. A
 * prompt is an interruption; an interruption triggered by an error is a bug wearing a banner. The
 * 2026-09-17 deleted donation panel is the precedent: it could only ever appear as the
 * "unresolved view" fallback.
 */
@Controller('supporter')
export class SupporterController {
  constructor(private readonly supporter: SupporterService) {}

  /** GET /api/supporter/status?kind=general — may a prompt appear right now, and why/why not. */
  @Get('status')
  async status(@Query('kind') kind?: string): Promise<SupporterStatus> {
    const k = kind ?? 'general';
    if (!(SUPPORTER_KINDS as readonly string[]).includes(k)) {
      throw new BadRequestException(
        `unknown kind "${k}" — declared kinds are: ${SUPPORTER_KINDS.join(', ')}`,
      );
    }
    return this.supporter.getStatus(k);
  }

  /**
   * POST /api/supporter/interaction — record a prompt being shown, or the answer to one.
   *
   * Two calls, one endpoint, because they are one history:
   *   `{ kind?, context? }`                    → shown (starts the cooldown)
   *   `{ kind?, response, context? }`          → answered (applies the side effect)
   *
   * ⚠️ Unknown values are REFUSED rather than stored. The store is what decides whether to ask
   * again, so an unrecognised answer that gets written is a row no rule understands — it would sit
   * there looking like a response while the user is asked again on the next request.
   */
  @Post('interaction')
  async record(
    @Body()
    body: { kind?: string; response?: string; context?: string },
  ) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('body must be { kind?, response?, context? }');
    }
    if (body.kind !== undefined && !(SUPPORTER_KINDS as readonly string[]).includes(body.kind)) {
      throw new BadRequestException(
        `unknown kind "${body.kind}" — declared kinds are: ${SUPPORTER_KINDS.join(', ')}`,
      );
    }
    if (
      body.response !== undefined &&
      !(SUPPORTER_RESPONSES as readonly string[]).includes(body.response)
    ) {
      throw new BadRequestException(
        `unknown response "${body.response}" — allowed: ${SUPPORTER_RESPONSES.join(', ')}`,
      );
    }
    if (body.context !== undefined && typeof body.context !== 'string') {
      throw new BadRequestException('context must be a string when supplied');
    }
    return this.supporter.record({
      kind: body.kind,
      response: body.response,
      context: body.context,
    });
  }
}
