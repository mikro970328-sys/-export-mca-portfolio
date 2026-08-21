-- B3.1 follow-up · índices para FKs compuestas cliente/importador

create index sales_orders_client_importer_idx
  on public.sales_orders(client_id, importer_id)
  where importer_id is not null;

create index loads_client_importer_idx
  on public.loads(client_id, importer_id)
  where importer_id is not null;
