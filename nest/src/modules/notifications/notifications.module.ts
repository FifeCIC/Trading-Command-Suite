import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notifications.service';
import { EmailChannel } from './channels/email.channel';
import { WindowsChannel } from './channels/windows.channel';
import { TelegramChannel } from './channels/telegram.channel';
import { DiscordChannel } from './channels/discord.channel';
//
// ⚠️ THERE IS NO `imports: [SystemModule]` HERE, AND ADDING ONE BREAKS THE API BOOT.
//
// `notifications.service.ts` injects `SettingsResolverService`, which SystemModule provides. The
// tempting fix is to import SystemModule — and doing that made the app fail to start:
//
//   UndefinedModuleException: Nest cannot create the SystemModule instance.
//   The module at index [0] of the SystemModule "imports" array is undefined.
//   Scope [AppModule -> SymbolsModule -> ProvidersModule -> NotificationsModule]
//
// ⚠️ THE CHECK THAT MISSED IT, recorded because the wrong question looks like the right one:
// the note that used to sit here verified that *SystemModule does not import NotificationsModule*
// — true, and irrelevant. The cycle is one edge longer:
//
//   SystemModule → ProvidersModule → NotificationsModule → SystemModule
//                  ^^^^^^^^^^^^^^^ ProvidersModule is index [0] of SystemModule's imports, so it is
//                  still `undefined` while SystemModule's decorator is being evaluated.
//
// **The import is unnecessary.** SystemModule is `@Global()` and its `exports` include
// `SettingsResolverService`, so it is injectable here without being imported — that is exactly what
// `@Global()` is for. NotificationsService takes it `@Optional()` and logs when it is missing, so if
// this ever stops resolving the failure is visible rather than silent.

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    EmailChannel,
    WindowsChannel,
    TelegramChannel,
    DiscordChannel,
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
