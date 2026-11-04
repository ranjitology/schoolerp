-- Runs once when the PostgreSQL data volume is first created.
-- The migration runner connects as `postgres` (owner/DDL). The API connects as
-- `erp_app`, which has DML only and is therefore subject to FORCE ROW LEVEL SECURITY.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app LOGIN PASSWORD 'erp_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE schoolerp TO erp_app;
GRANT USAGE ON SCHEMA public TO erp_app;

ALTER DATABASE schoolerp SET timezone TO 'UTC';
ALTER DATABASE schoolerp SET statement_timeout TO '30s';
ALTER DATABASE schoolerp SET idle_in_transaction_session_timeout TO '60s';
