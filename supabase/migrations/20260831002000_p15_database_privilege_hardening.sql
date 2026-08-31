-- P15 · B9.1 Database privilege hardening
-- ERP authority remains backend-only through service_role + P3 authorization.
-- Do not re-grant direct anon/authenticated access here; public HTTP owners use backend APIs.

-- Existing public-schema objects: remove direct Data API privileges from browser roles.
-- PostgreSQL treats views as tables for GRANT/REVOKE purposes, so this also closes public views.
revoke all privileges on all tables in schema public from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Remove legacy authenticated-all policies that bypassed the P3 module/action matrix.
drop policy if exists authenticated_access_documents on public.documents;
drop policy if exists authenticated_access_expenses on public.expenses;
drop policy if exists authenticated_access_importers on public.importers;
drop policy if exists authenticated_access_operation_items on public.operation_items;
drop policy if exists authenticated_access_operations on public.operations;
drop policy if exists authenticated_access_products on public.products;
drop policy if exists authenticated_access_suppliers on public.suppliers;

-- Supabase security advisor: trigger helper must not inherit a mutable search_path.
alter function public.set_commercial_publications_updated_at()
  set search_path = public, pg_temp;

-- Future application objects are created by postgres. Make browser access opt-in instead of
-- inheriting Supabase's historical broad defaults. service_role grants remain untouched.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Note: managed default ACL entries owned by supabase_admin cannot be altered by the postgres
-- migration role. P15's CI/runtime audit treats any future anon/authenticated exposure as a failure.
