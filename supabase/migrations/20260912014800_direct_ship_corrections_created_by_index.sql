-- Cover the audit actor foreign key added by Direct Ship physical quantity corrections.
create index if not exists direct_shipment_quantity_corrections_created_by_idx
  on public.direct_shipment_quantity_corrections(created_by)
  where created_by is not null;
