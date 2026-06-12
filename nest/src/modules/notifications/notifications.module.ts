import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notifications.service';
import { EmailChannel } from './channels/email.channel';
import { WindowsChannel } from './channels/windows.channel';
import { TelegramChannel } from './channels/telegram.channel';
import { DiscordChannel } from './channels/discord.channel';

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
