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
// A firing condition is a persistent fault with a recurrence count, not only an alert row that
// auto-dismisses after 3 days. No cycle: FaultsModule depends only on the (global) database.
import { FaultsModule } from '../faults/faults.module';

@Module({
  imports: [CalendarModule, ProvidersModule, NotificationsModule, FaultsModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertTriggerService],
  exports: [AlertsService],
})
export class AlertsModule {}
