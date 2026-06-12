import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FaqService } from './faq.service';

@ApiTags('faq')
@Controller('faq')
export class FaqController {
  constructor(private readonly faqService: FaqService) {}

  @Get()
  @ApiOperation({ summary: 'List FAQ entries with optional search and category filter' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiOkResponse({ description: 'FAQ entries matching criteria' })
  findAll(
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.faqService.findAll(search, category);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List FAQ categories with entry counts' })
  @ApiOkResponse({ description: 'Category list' })
  getCategories() {
    return this.faqService.getCategories();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single FAQ entry' })
  @ApiOkResponse({ description: 'FAQ entry' })
  findOne(@Param('id') id: string) {
    return this.faqService.findOne(id);
  }
}
