import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Body for POST /api/capabilities — capability map entries (#673).
 * Replaces the old query-string mutation surface; validation follows the
 * same DTO pipeline as the rest of the backend.
 */
export class CreateCapabilityDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsIn(['ALPHA', 'BETA', 'LIVE'])
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  dataPersistence?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  uiSurfaces?: number;

  @IsOptional()
  @IsString()
  pipelineIntegration?: string;

  @IsOptional()
  @IsString()
  devCompletion?: string;
}
