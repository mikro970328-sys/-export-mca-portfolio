-- P4 · Índices de soporte para FKs de auditoría del motor de tareas.
create index if not exists operational_task_comments_author_admin_idx
  on public.operational_task_comments(author_admin_id)
  where author_admin_id is not null;

create index if not exists operational_task_history_actor_admin_idx
  on public.operational_task_history(actor_admin_id)
  where actor_admin_id is not null;

create index if not exists operational_task_dependencies_created_by_idx
  on public.operational_task_dependencies(created_by)
  where created_by is not null;
