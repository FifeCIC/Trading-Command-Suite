import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DirectivesService } from './directives.service';

@ApiTags('directives')
@Controller('directives')
export class DirectivesController {
  constructor(private readonly directivesService: DirectivesService) {}

  @Get()
  @ApiOperation({ summary: 'List all registered directives with metadata' })
  @ApiOkResponse({ description: 'Array of directive definitions' })
  list() {
    const directives = this.directivesService.list();
    return directives.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description ?? '',
      priority: d.priority ?? 50,
    }));
  }
}
