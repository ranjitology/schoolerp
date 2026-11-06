-- Payment reconciliation.
--
-- A reconciliation run compares a provider settlement feed with the locally
-- recorded payment intents. The header stores the totals an accountant reviews;
-- each line stores the provider reference and the matching outcome so a
-- mismatch can be investigated without re-importing the feed.

CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

CREATE TYPE "SettlementMatchStatus" AS ENUM (
    'MATCHED',
    'AMOUNT_MISMATCH',
    'STATUS_MISMATCH',
    'MISSING_INTENT',
    'MISSING_PAYMENT',
    'DUPLICATE'
);

CREATE TABLE "payment_reconciliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "currency" CHAR(3) NOT NULL DEFAULT 'NPR',
    "linesTotal" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "unsettledCount" INTEGER NOT NULL DEFAULT 0,
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "payment_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_settlement_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "reconciliationId" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "providerRef" VARCHAR(160) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'NPR',
    "providerStatus" VARCHAR(40) NOT NULL DEFAULT 'SETTLED',
    "settledAt" TIMESTAMPTZ(6) NOT NULL,
    "matchStatus" "SettlementMatchStatus" NOT NULL,
    "intentId" UUID,
    "paymentId" UUID,
    "notes" VARCHAR(500),

    CONSTRAINT "payment_settlement_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_reconciliations_school_id_provider_createdAt_idx"
    ON "payment_reconciliations"("school_id", "provider", "createdAt");
CREATE INDEX "payment_reconciliations_school_id_status_createdAt_idx"
    ON "payment_reconciliations"("school_id", "status", "createdAt");

CREATE INDEX "payment_settlement_lines_school_id_provider_providerRef_idx"
    ON "payment_settlement_lines"("school_id", "provider", "providerRef");
CREATE INDEX "payment_settlement_lines_school_id_reconciliationId_matchStatus_idx"
    ON "payment_settlement_lines"("school_id", "reconciliationId", "matchStatus");

ALTER TABLE "payment_reconciliations"
    ADD CONSTRAINT "payment_reconciliations_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_settlement_lines"
    ADD CONSTRAINT "payment_settlement_lines_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_settlement_lines"
    ADD CONSTRAINT "payment_settlement_lines_reconciliationId_fkey"
    FOREIGN KEY ("reconciliationId") REFERENCES "payment_reconciliations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

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
