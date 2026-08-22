import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ParseEarningsWhisperDto {
  /** Full Earnings Whispers email dump (raw text). */
  @IsString()
  @MaxLength(200_000)
  text!: string;

  /** Persist the parsed entries to the database. */
  @IsOptional()
  @IsBoolean()
  save?: boolean;
}
