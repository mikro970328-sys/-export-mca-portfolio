-- B2.0 · Proveedores como maestro real para Compras/WR
-- No modifica WR históricos ni crea Purchase Orders.

ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_name_not_blank
  CHECK (btrim(name) <> '');

CREATE UNIQUE INDEX suppliers_name_normalized_uidx
  ON public.suppliers (lower(btrim(name)));

CREATE INDEX warehouse_receipts_supplier_id_idx
  ON public.warehouse_receipts (supplier_id)
  WHERE supplier_id IS NOT NULL;
