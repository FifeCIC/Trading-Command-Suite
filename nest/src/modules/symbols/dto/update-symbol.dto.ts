import { PartialType } from '@nestjs/swagger';
import { CreateSymbolDto } from './create-symbol.dto';

export class UpdateSymbolDto extends PartialType(CreateSymbolDto) {}
