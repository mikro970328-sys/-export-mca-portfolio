\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.clients') IS NULL THEN
    RAISE EXCEPTION 'clients no existe';
  END IF;
  IF to_regclass('public.shipments') IS NULL THEN
    RAISE EXCEPTION 'shipments no existe';
  END IF;
  IF to_regclass('public.shipment_history') IS NULL THEN
    RAISE EXCEPTION 'shipment_history no existe';
  END IF;
  IF to_regclass('public.audit_log') IS NULL THEN
    RAISE EXCEPTION 'audit_log no existe';
  END IF;
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'companies no fue creada';
  END IF;
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'profiles no fue creada';
  END IF;
  IF to_regclass('public.roles') IS NULL THEN
    RAISE EXCEPTION 'roles no fue creada';
  END IF;
  IF to_regclass('public.permissions') IS NULL THEN
    RAISE EXCEPTION 'permissions no fue creada';
  END IF;
  IF to_regclass('public.client_contacts') IS NULL THEN
    RAISE EXCEPTION 'client_contacts no fue creada';
  END IF;
  IF to_regclass('public.client_assignments') IS NULL THEN
    RAISE EXCEPTION 'client_assignments no fue creada';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'company_id'
  ) THEN
    RAISE EXCEPTION 'clients.company_id no fue creada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'company_id'
  ) THEN
    RAISE EXCEPTION 'audit_log.company_id no fue creada';
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'companies_set_updated_at' AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION 'trigger companies_set_updated_at ausente o duplicado';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'profiles_set_updated_at' AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION 'trigger profiles_set_updated_at ausente o duplicado';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'roles_set_updated_at' AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION 'trigger roles_set_updated_at ausente o duplicado';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'client_contacts_set_updated_at' AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION 'trigger client_contacts_set_updated_at ausente o duplicado';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_clients_company_status') THEN
    RAISE EXCEPTION 'falta idx_clients_company_status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_client_assignments_user') THEN
    RAISE EXCEPTION 'falta idx_client_assignments_user';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_audit_log_company_created') THEN
    RAISE EXCEPTION 'falta idx_audit_log_company_created';
  END IF;
END $$;

INSERT INTO public.clients (name, email) VALUES ('Cliente de prueba', 'test@example.com');
INSERT INTO public.shipments (client_id, container_number, status)
SELECT id, 'TEST1234567', 'created' FROM public.clients WHERE email = 'test@example.com' LIMIT 1;
INSERT INTO public.audit_log (entity_type, entity_id, action)
SELECT 'client', id, 'test' FROM public.clients WHERE email = 'test@example.com' LIMIT 1;

SELECT 'Prueba PostgreSQL de Arquitectura 1.0 superada' AS result;
