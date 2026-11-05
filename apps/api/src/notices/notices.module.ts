import { Module } from '@nestjs/common';
import {
  NoticesController,
  NotificationsController,
  PortalNoticesController,
} from './notices.controller';
import { NoticesService } from './notices.service';
import { PushModule } from '../push/push.module';

@Module({
  imports: [PushModule],
  controllers: [NoticesController, PortalNoticesController, NotificationsController],
  providers: [NoticesService],
  exports: [NoticesService],
})
export class NoticesModule {}
