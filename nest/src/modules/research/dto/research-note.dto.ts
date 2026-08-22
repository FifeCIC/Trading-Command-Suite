import { IsArray, IsString } from 'class-validator';

export class CreateResearchNoteDto {
  @IsString()
  content: string;
}

export class UpdateResearchNoteDto {
  @IsString()
  content: string;
}

export class ReorderResearchNotesDto {
  @IsArray()
  orderedIds: string[];
}
