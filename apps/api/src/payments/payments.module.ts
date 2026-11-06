import { Module } from '@nestjs/common';
import { FeesModule } from '../fees/fees.module';
import { PaymentsController, PortalPaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [FeesModule],
  controllers: [PaymentsController, PortalPaymentsController, ReconciliationController],
  providers: [PaymentsService, ReconciliationService],
})
export class PaymentsModule {}
