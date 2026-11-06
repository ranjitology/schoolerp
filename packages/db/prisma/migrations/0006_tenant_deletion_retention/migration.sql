-- Tenant deletion lifecycle.
--
-- A tenant is first soft-deleted with a grace period, then purged. The purge
-- removes operational tenant rows but deliberately keeps `audit_logs` and
-- `platform_audit_logs`: those are the compliance evidence of what was deleted
-- and are append-only. The `schools` row is anonymised and retained as the
-- anchor for the audit chain.

ALTER TABLE "schools"
    ADD COLUMN "deletionRequestedAt" TIMESTAMPTZ(6),
    ADD COLUMN "purgeAfter" TIMESTAMPTZ(6),
    ADD COLUMN "deletionReason" VARCHAR(500);

CREATE INDEX "schools_purgeAfter_idx" ON "schools"("purgeAfter");

-- Deletes every row that carries school_id, in dependency-safe passes. Some
-- foreign keys are RESTRICT rather than CASCADE, so a block is retried until
-- children have been removed. audit_logs is intentionally excluded because the
-- append-only trigger rejects DELETE and the chain must survive the purge.
CREATE OR REPLACE FUNCTION public.purge_tenant_data(target_school uuid)
RETURNS TABLE (table_name text, deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    candidate record;
    removed bigint;
    blocked integer;
    passes integer := 0;
BEGIN
    IF current_setting('app.is_platform', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'tenant purge requires platform context';
    END IF;

    LOOP
        passes := passes + 1;
        blocked := 0;

        FOR candidate IN
            SELECT c.table_name::text AS table_name
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema
             AND t.table_name = c.table_name
             AND t.table_type = 'BASE TABLE'
            WHERE c.table_schema = 'public'
              AND c.column_name = 'school_id'
              AND c.table_name NOT IN ('schools', 'audit_logs', 'platform_audit_logs')
            ORDER BY c.table_name
        LOOP
            BEGIN
                EXECUTE format('DELETE FROM public.%I WHERE school_id = $1', candidate.table_name)
                    USING target_school;
                GET DIAGNOSTICS removed = ROW_COUNT;
                IF removed > 0 THEN
                    table_name := candidate.table_name;
                    deleted := removed;
                    RETURN NEXT;
                END IF;
            EXCEPTION WHEN foreign_key_violation THEN
                blocked := blocked + 1;
            END;
        END LOOP;

        EXIT WHEN blocked = 0;
        IF passes >= 20 THEN
            RAISE EXCEPTION 'tenant purge could not resolve foreign keys';
        END IF;
    END LOOP;
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
        REVOKE ALL ON FUNCTION public.purge_tenant_data(uuid) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION public.purge_tenant_data(uuid) TO erp_app;
    END IF;
END
$$;
