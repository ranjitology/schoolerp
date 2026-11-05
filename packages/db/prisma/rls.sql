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
