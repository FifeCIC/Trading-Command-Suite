import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertTriggerService } from './alert-trigger.service';
import { WindowsNotifyService } from './windows-notify.service';
import { CalendarModule } from '../calendar/calendar.module';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [CalendarModule, ProvidersModule],
  controllers: [AlertsController],
  // WindowsNotifyService is exported so any other subsystem that finds a condition worth
  // interrupting a human for can raise one, instead of each growing its own PowerShell call.
  providers: [AlertsService, AlertTriggerService, WindowsNotifyService],
  exports: [AlertsService, WindowsNotifyService],
})
export class AlertsModule {}
