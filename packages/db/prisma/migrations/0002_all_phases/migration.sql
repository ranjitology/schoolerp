-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "dataPlane" VARCHAR(16) NOT NULL DEFAULT 'SHARED',
ADD COLUMN     "dedicatedDbRef" VARCHAR(120);

-- CreateTable
CREATE TABLE "library_books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "isbn" VARCHAR(32),
    "title" VARCHAR(200) NOT NULL,
    "author" VARCHAR(160) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "available" INTEGER NOT NULL DEFAULT 1,
    "location" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "library_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "issuedByUserId" UUID,
    "issueDate" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATE NOT NULL,
    "returnDate" DATE,
    "fineMinor" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "library_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "vehicleNo" VARCHAR(40) NOT NULL,
    "driverName" VARCHAR(120) NOT NULL,
    "driverPhone" VARCHAR(24) NOT NULL,
    "fareMinor" INTEGER NOT NULL DEFAULT 0,
    "stops" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transport_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "stop" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'BOYS',
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "wardenId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hostels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "hostelId" UUID NOT NULL,
    "roomNo" VARCHAR(20) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "occupied" INTEGER NOT NULL DEFAULT 0,
    "rentMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hostel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "hostelId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hostel_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "unitPriceMinor" INTEGER NOT NULL DEFAULT 0,
    "location" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reference" VARCHAR(80),
    "notes" VARCHAR(500),
    "performedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_bank" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'MCQ',
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "answer" TEXT NOT NULL,
    "marks" INTEGER NOT NULL DEFAULT 1,
    "difficulty" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "question_bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "subject" VARCHAR(160) NOT NULL,
    "createdByUserId" UUID,
    "participantIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "readBy" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_usage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "metric" VARCHAR(40) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "period" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" VARCHAR(1000),
    "requestedByUserId" UUID,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "deviceId" VARCHAR(120) NOT NULL,
    "userId" UUID,
    "operation" VARCHAR(60) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'APPLIED',
    "applied" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "library_books_school_id_title_idx" ON "library_books"("school_id", "title");

-- CreateIndex
CREATE UNIQUE INDEX "library_books_school_id_isbn_key" ON "library_books"("school_id", "isbn");

-- CreateIndex
CREATE INDEX "library_issues_school_id_studentId_status_idx" ON "library_issues"("school_id", "studentId", "status");

-- CreateIndex
CREATE INDEX "library_issues_school_id_bookId_status_idx" ON "library_issues"("school_id", "bookId", "status");

-- CreateIndex
CREATE INDEX "transport_routes_school_id_name_idx" ON "transport_routes"("school_id", "name");

-- CreateIndex
CREATE INDEX "transport_assignments_school_id_routeId_idx" ON "transport_assignments"("school_id", "routeId");

-- CreateIndex
CREATE UNIQUE INDEX "transport_assignments_school_id_studentId_key" ON "transport_assignments"("school_id", "studentId");

-- CreateIndex
CREATE INDEX "hostels_school_id_name_idx" ON "hostels"("school_id", "name");

-- CreateIndex
CREATE INDEX "hostel_rooms_school_id_hostelId_idx" ON "hostel_rooms"("school_id", "hostelId");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_rooms_hostelId_roomNo_key" ON "hostel_rooms"("hostelId", "roomNo");

-- CreateIndex
CREATE INDEX "hostel_allocations_school_id_studentId_status_idx" ON "hostel_allocations"("school_id", "studentId", "status");

-- CreateIndex
CREATE INDEX "hostel_allocations_school_id_hostelId_roomId_idx" ON "hostel_allocations"("school_id", "hostelId", "roomId");

-- CreateIndex
CREATE INDEX "inventory_items_school_id_category_idx" ON "inventory_items"("school_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_school_id_sku_key" ON "inventory_items"("school_id", "sku");

-- CreateIndex
CREATE INDEX "inventory_transactions_school_id_itemId_createdAt_idx" ON "inventory_transactions"("school_id", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "question_bank_school_id_subjectId_type_idx" ON "question_bank"("school_id", "subjectId", "type");

-- CreateIndex
CREATE INDEX "message_threads_school_id_createdAt_idx" ON "message_threads"("school_id", "createdAt");

-- CreateIndex
CREATE INDEX "messages_school_id_threadId_createdAt_idx" ON "messages"("school_id", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "meter_usage_school_id_period_idx" ON "meter_usage"("school_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "meter_usage_school_id_metric_period_key" ON "meter_usage"("school_id", "metric", "period");

-- CreateIndex
CREATE INDEX "background_jobs_school_id_status_createdAt_idx" ON "background_jobs"("school_id", "status", "createdAt");

-- CreateIndex
CREATE INDEX "sync_batches_school_id_deviceId_createdAt_idx" ON "sync_batches"("school_id", "deviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sync_batches_school_id_idempotencyKey_key" ON "sync_batches"("school_id", "idempotencyKey");


-- Re-apply tenant isolation and grants to tables added after 0001.

-- Tenant isolation for the shared-schema database.
--
-- Run after every migration (the migration itself includes this file's
-- contents at the end so a fresh deploy is protected atomically).
--
-- Contract:
--   app.school_id   -> UUID of the current tenant (set transaction-locally)
--   app.is_platform -> 'true' only inside an audited super-admin transaction
--
-- FORCE ROW LEVEL SECURITY means even the table owner is constrained. Only
-- roles with BYPASSRLS/superuser (migration runner) bypass it.

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
     AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'school_id'
      AND c.table_name NOT IN ('schools')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', target.table_name);
    EXECUTE format($policy$
      CREATE POLICY tenant_isolation ON public.%I
      USING (
        current_setting('app.is_platform', true) = 'true'
        OR school_id = nullif(current_setting('app.school_id', true), '')::uuid
      )
      WITH CHECK (
        current_setting('app.is_platform', true) = 'true'
        OR school_id = nullif(current_setting('app.school_id', true), '')::uuid
      )
    $policy$, target.table_name);
  END LOOP;
END
$$;

-- Audit logs are append-only: no UPDATE, DELETE or TRUNCATE through the app.
CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (attempted %)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON public.audit_logs;
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_audit_mutation();

-- The application connects as a non-owner role. Owners/migration runners keep
-- DDL rights; erp_app only gets DML and is always subject to RLS.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT USAGE ON SCHEMA public TO erp_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
  END IF;
END
$$;
