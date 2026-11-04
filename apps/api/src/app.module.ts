import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AcademicsModule } from './academics/academics.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { PermissionsGuard, TenantAuthGuard } from './auth/auth.guard';
import { AllExceptionsFilter } from './common/exception.filter';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { TenantRateLimitGuard } from './common/rate-limit';
import { DashboardModule } from './dashboard/dashboard.module';
import { FeesModule } from './fees/fees.module';
import { HealthModule } from './health/health.module';
import { NoticesModule } from './notices/notices.module';
import { PlatformModule } from './platform/platform.module';
import { PrismaModule } from './prisma/prisma.module';
import { StudentsModule } from './students/students.module';
import { AdmissionsModule } from './admissions/admissions.module';
import { HrModule } from './hr/hr.module';
import { PayrollModule } from './payroll/payroll.module';
import { LibraryModule } from './library/library.module';
import { TransportModule } from './transport/transport.module';
import { HostelModule } from './hostel/hostel.module';
import { InventoryModule } from './inventory/inventory.module';
import { HomeworkModule } from './homework/homework.module';
import { QuestionBankModule } from './question-bank/question-bank.module';
import { MessagesModule } from './messages/messages.module';
import { StorageModule } from './storage/storage.module';
import { DocumentsModule } from './documents/documents.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { JobsModule } from './jobs/jobs.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    PlatformModule,
    StudentsModule,
    AttendanceModule,
    AcademicsModule,
    FeesModule,
    NoticesModule,
    DashboardModule,
    HealthModule,
    AdmissionsModule,
    HrModule,
    PayrollModule,
    LibraryModule,
    TransportModule,
    HostelModule,
    InventoryModule,
    HomeworkModule,
    QuestionBankModule,
    MessagesModule,
    StorageModule,
    DocumentsModule,
    ReportsModule,
    SettingsModule,
    JobsModule,
    SyncModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: TenantAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: TenantRateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
