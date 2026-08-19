-- A1 · completar índices de claves foráneas del núcleo de cargues.
-- Hallado por Supabase Performance Advisor durante la revisión A1.

create index loads_created_by_idx on public.loads(created_by);
