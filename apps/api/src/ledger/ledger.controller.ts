import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  LedgerService,
  journalQuerySchema,
  trialBalanceQuerySchema,
} from './ledger.service';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('accounts')
  @RequirePermissions('fees:read')
  accounts(@CurrentAuth() auth: AuthPrincipal) {
    return this.ledger.accounts(auth);
  }

  @Get('trial-balance')
  @RequirePermissions('fees:read')
  trialBalance(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(trialBalanceQuerySchema)) query: z.infer<typeof trialBalanceQuerySchema>,
  ) {
    return this.ledger.trialBalance(auth, query);
  }

  @Get('journal')
  @RequirePermissions('fees:read')
  journal(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(journalQuerySchema)) query: z.infer<typeof journalQuerySchema>,
  ) {
    return this.ledger.journal(auth, query);
  }
}
