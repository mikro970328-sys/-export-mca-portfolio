create index if not exists inventory_movements_product_idx
  on public.inventory_movements(product_id);

create index if not exists inventory_movements_created_by_idx
  on public.inventory_movements(created_by);
