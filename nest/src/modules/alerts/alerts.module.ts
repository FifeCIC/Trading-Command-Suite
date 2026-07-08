import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertTriggerService } from './alert-trigger.service';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [CalendarModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertTriggerService],
  exports: [AlertsService],
})
export class AlertsModule {}
