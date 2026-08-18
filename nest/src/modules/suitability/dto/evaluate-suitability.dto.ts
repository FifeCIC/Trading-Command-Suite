import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * Body for POST /api/suitability/evaluate.
 *
 * A suitability evaluation must work with ZERO market data — a freshly surfaced
 * symbol (screener hit) may have no Symbol row yet. `type` and `shortable` are
 * optional overrides; when omitted they are resolved from the Symbol table (if
 * present) or left unknown.
 */
export class EvaluateSuitabilityDto {
  @IsString()
  ticker: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsBoolean()
  shortable?: boolean;
}
