import { Module } from '@nestjs/common';
import {
  NoticesController,
  NotificationsController,
  PortalNoticesController,
} from './notices.controller';
import { NoticesService } from './notices.service';

@Module({
  controllers: [NoticesController, PortalNoticesController, NotificationsController],
  providers: [NoticesService],
  exports: [NoticesService],
})
export class NoticesModule {}
