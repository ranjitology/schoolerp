import { Module } from '@nestjs/common';
import { NoticesModule } from '../notices/notices.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [NoticesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
