-- Retira la relación legacy 1:1 operations.shipment_id.
-- La relación canónica es shipments.operation_id -> operations.id y permite varios contenedores por expediente.
-- Auditoría previa: 0/3 operations usan shipment_id; no existen vistas/funciones dependientes de esta columna.

alter table public.operations
  drop constraint operations_shipment_id_fkey;

drop index public.idx_operations_shipment_id;

alter table public.operations
  drop column shipment_id;
