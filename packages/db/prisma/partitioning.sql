-- Monthly partitioning for audit_logs (production runbook step).
--
-- Prisma's migration creates audit_logs with primary key (id, created_at) so it
-- can be converted in place. Run this during a maintenance window once the
-- table is large enough to benefit (>10M rows), then create next month's
-- partition ahead of time from the monthly maintenance job:
--
--   SELECT public.create_audit_partition(now() + interval '1 month');
--
-- Retention: detach partitions older than the tenant's retention policy and
-- archive them to S3 before dropping. Never DELETE audit rows.

CREATE OR REPLACE FUNCTION public.create_audit_partition(month_start timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  partition_name text := 'audit_logs_' || to_char(month_start, 'YYYY_MM');
  range_start timestamptz := date_trunc('month', month_start);
  range_end timestamptz := range_start + interval '1 month';
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.audit_logs
       FOR VALUES FROM (%L) TO (%L)',
    partition_name, range_start, range_end
  );
  RETURN partition_name;
END;
$$;

-- One-off conversion (run only if audit_logs is not already partitioned):
--
-- BEGIN;
--   ALTER TABLE public.audit_logs RENAME TO audit_logs_legacy;
--   CREATE TABLE public.audit_logs (LIKE public.audit_logs_legacy INCLUDING ALL)
--     PARTITION BY RANGE (created_at);
--   SELECT public.create_audit_partition(now());
--   INSERT INTO public.audit_logs SELECT * FROM public.audit_logs_legacy;
--   DROP TABLE public.audit_logs_legacy;
--   -- re-apply prisma/rls.sql to restore policies/triggers
-- COMMIT;
