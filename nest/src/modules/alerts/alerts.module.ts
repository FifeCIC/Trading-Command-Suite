import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertTriggerService } from './alert-trigger.service';
import { CalendarModule } from '../calendar/calendar.module';
import { ProvidersModule } from '../providers/providers.module';
// ⚠️ The ONE notification dispatcher. `WindowsNotifyService` used to live in this module as a
// duplicate of `NotificationsModule`'s Windows channel and has been deleted — see the note on
// `fireAlert()`.
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [CalendarModule, ProvidersModule, NotificationsModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertTriggerService],
  exports: [AlertsService],
})
export class AlertsModule {}
