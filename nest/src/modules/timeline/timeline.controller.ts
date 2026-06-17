import { Controller, Get, Query } from '@nestjs/common';
import { TimelineService } from './timeline.service';

@Controller('timeline')
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get()
  getTimeline(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('view') view?: string,
  ) {
    const today = new Date();
    const fromDate = from || today.toISOString().split('T')[0];
    const toDate = to || new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];
    return this.timeline.getTimeline(fromDate, toDate, view || 'week');
  }
}
