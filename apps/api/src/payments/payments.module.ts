import { Module } from '@nestjs/common';
import { FeesModule } from '../fees/fees.module';
import { PaymentsController, PortalPaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [FeesModule],
  controllers: [PaymentsController, PortalPaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
