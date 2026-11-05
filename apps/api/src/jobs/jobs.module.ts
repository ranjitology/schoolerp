import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobDispatcher } from './job-dispatcher';

@Module({
  controllers: [JobsController],
  providers: [JobsService, JobDispatcher],
  exports: [JobsService],
})
export class JobsModule {}
