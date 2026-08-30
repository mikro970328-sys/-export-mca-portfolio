-- P2 · índices de soporte para claves foráneas de anticipos y Proformas

create index if not exists customer_advances_created_by_idx
  on public.customer_advances(created_by);
create index if not exists customer_advances_reversed_by_idx
  on public.customer_advances(reversed_by);

create index if not exists customer_advance_applications_created_by_idx
  on public.customer_advance_applications(created_by);
create index if not exists customer_advance_applications_reversed_by_idx
  on public.customer_advance_applications(reversed_by);

create index if not exists customer_advance_refunds_created_by_idx
  on public.customer_advance_refunds(created_by);
create index if not exists customer_advance_refunds_reversed_by_idx
  on public.customer_advance_refunds(reversed_by);

create index if not exists proformas_importer_id_idx
  on public.proformas(importer_id);
create index if not exists proformas_created_by_idx
  on public.proformas(created_by);
create index if not exists proformas_issued_by_idx
  on public.proformas(issued_by);
create index if not exists proformas_voided_by_idx
  on public.proformas(voided_by);

create index if not exists proforma_items_sales_order_item_id_idx
  on public.proforma_items(sales_order_item_id);
create index if not exists proforma_items_product_id_idx
  on public.proforma_items(product_id);
