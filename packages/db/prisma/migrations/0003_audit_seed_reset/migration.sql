-- Controlled audit maintenance for demo seed resets.
--
-- Audit rows stay append-only for the application role. A maintenance session
-- may clear them only when it (a) opts in with a transaction-local GUC and
-- (b) holds TRUNCATE on audit_logs. The runtime role erp_app is granted only
-- SELECT/INSERT/UPDATE/DELETE, so it can never satisfy the privilege check.
CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  seed_reset text := current_setting('schoolerp.audit_seed_reset', true);
  can_truncate boolean := has_table_privilege(current_user, TG_RELID, 'TRUNCATE');
BEGIN
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
