import { IsArray, IsOptional, IsString } from 'class-validator';

export class SignalLadderDto {
  @IsArray()
  @IsString({ each: true })
  symbols: string[];

  @IsOptional()
  @IsString()
  protocol?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  protocols?: string[];
}
