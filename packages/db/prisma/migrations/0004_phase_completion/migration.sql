-- Phase 4-7 completion: ledger, hosted payments, push subscriptions,
-- generated documents and security-safe reporting rollups.

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "LedgerNormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "normalBalance" "LedgerNormalBalance" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "entryDate" DATE NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "sourceType" VARCHAR(40) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "debitMinor" INTEGER NOT NULL DEFAULT 0,
    "creditMinor" INTEGER NOT NULL DEFAULT 0,
    "memo" VARCHAR(240),

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "invoiceId" UUID,
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NPR',
    "provider" VARCHAR(40) NOT NULL,
    "providerRef" VARCHAR(160),
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "paymentId" UUID,
    "createdByUserId" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "eventId" VARCHAR(160) NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMPTZ(6),
    "error" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" VARCHAR(500) NOT NULL,
    "p256dh" VARCHAR(200) NOT NULL,
    "auth" VARCHAR(200) NOT NULL,
    "userAgent" VARCHAR(500),
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "templateId" UUID,
    "templateCode" VARCHAR(40) NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" VARCHAR(120) NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_daily_attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_daily_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_fee_collection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_fee_collection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_school_id_code_key" ON "ledger_accounts"("school_id", "code");
CREATE INDEX "ledger_accounts_school_id_type_idx" ON "ledger_accounts"("school_id", "type");

CREATE UNIQUE INDEX "journal_entries_school_id_sourceType_sourceId_key" ON "journal_entries"("school_id", "sourceType", "sourceId");
CREATE UNIQUE INDEX "journal_entries_school_id_number_key" ON "journal_entries"("school_id", "number");
CREATE INDEX "journal_entries_school_id_entryDate_idx" ON "journal_entries"("school_id", "entryDate");

CREATE INDEX "journal_lines_school_id_accountId_idx" ON "journal_lines"("school_id", "accountId");
CREATE INDEX "journal_lines_school_id_entryId_idx" ON "journal_lines"("school_id", "entryId");

CREATE UNIQUE INDEX "payment_intents_school_id_idempotencyKey_key" ON "payment_intents"("school_id", "idempotencyKey");
CREATE UNIQUE INDEX "payment_intents_school_id_provider_providerRef_key" ON "payment_intents"("school_id", "provider", "providerRef");
CREATE INDEX "payment_intents_school_id_status_createdAt_idx" ON "payment_intents"("school_id", "status", "createdAt");

CREATE UNIQUE INDEX "payment_webhook_events_provider_eventId_key" ON "payment_webhook_events"("provider", "eventId");
CREATE INDEX "payment_webhook_events_school_id_provider_createdAt_idx" ON "payment_webhook_events"("school_id", "provider", "createdAt");

CREATE UNIQUE INDEX "push_subscriptions_userId_endpoint_key" ON "push_subscriptions"("userId", "endpoint");
CREATE INDEX "push_subscriptions_school_id_userId_idx" ON "push_subscriptions"("school_id", "userId");

CREATE UNIQUE INDEX "document_templates_school_id_code_key" ON "document_templates"("school_id", "code");

CREATE INDEX "generated_documents_school_id_templateCode_createdAt_idx" ON "generated_documents"("school_id", "templateCode", "createdAt");
CREATE INDEX "generated_documents_school_id_entityType_entityId_idx" ON "generated_documents"("school_id", "entityType", "entityId");

CREATE UNIQUE INDEX "report_daily_attendance_school_id_date_status_key" ON "report_daily_attendance"("school_id", "date", "status");
CREATE INDEX "report_daily_attendance_school_id_date_idx" ON "report_daily_attendance"("school_id", "date");

CREATE UNIQUE INDEX "report_fee_collection_school_id_date_method_key" ON "report_fee_collection"("school_id", "date", "method");
CREATE INDEX "report_fee_collection_school_id_date_idx" ON "report_fee_collection"("school_id", "date");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_daily_attendance" ADD CONSTRAINT "report_daily_attendance_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_fee_collection" ADD CONSTRAINT "report_fee_collection_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
DECLARE
  seed_reset text := current_setting('schoolerp.audit_seed_reset', true);
  can_truncate boolean := has_table_privilege(current_user, TG_RELID, 'TRUNCATE');
BEGIN
  -- Demo seed resets may clear rows only from a maintenance session that
  -- holds TRUNCATE. The application role has DML only, so it cannot opt in.
  IF seed_reset = 'on' AND can_truncate THEN
    IF TG_LEVEL = 'ROW' THEN
      RETURN OLD;
    END IF;
    RETURN NULL;
  END IF;

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

