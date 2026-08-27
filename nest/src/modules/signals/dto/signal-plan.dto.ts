import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Body for POST /api/signals/:id/plan — Signals → Trading handover (#702).
 *
 * `direction` is required; `context` is an optional snapshot of the envelope
 * as shown on the Signals card (combined strength, top directives, warnings)
 * so the created plan carries the full signal context into the Trading area.
 */
export class SignalPlanDto {
  @IsIn(['LONG', 'SHORT'])
  direction: 'LONG' | 'SHORT';

  @IsOptional()
  @IsString()
  protocolName?: string;

  @IsOptional()
  @IsObject()
  context?: {
    combinedStrength?: number;
    signalPct?: number;
    opportunityPct?: number;
    confidence?: number;
    topDirectives?: Array<{ name?: string; reason?: string }>;
    warnings?: string[];
  };
}
