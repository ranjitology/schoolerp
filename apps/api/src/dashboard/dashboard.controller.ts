import { Controller, Get } from '@nestjs/common';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AuthPrincipal } from '../common/request';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions('dashboard:view')
  overview(@CurrentAuth() auth: AuthPrincipal) {
    return this.dashboard.overview(auth);
  }

  @Get('me')
  @RequirePermissions('dashboard:view')
  me(@CurrentAuth() auth: AuthPrincipal) {
    return this.dashboard.me(auth);
  }
}
