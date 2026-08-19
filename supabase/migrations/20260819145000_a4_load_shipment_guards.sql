-- A4 · Protecciones de shipments vinculados a Cargues.
-- Evita fuentes de verdad paralelas y estados logísticos incompatibles.

create function public.guard_load_linked_shipment_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_load_status text;
begin
  select status into v_load_status
  from public.loads
  where shipment_id = old.id
  limit 1;

  if v_load_status is null then
    return new;
  end if;

  if new.product is distinct from old.product
     or new.quantity is distinct from old.quantity
     or new.quantity_unit is distinct from old.quantity_unit then
    raise exception 'LOAD_SHIPMENT_MERCHANDISE_DERIVED';
  end if;

  if v_load_status <> 'dispatched' then
    if new.delivered_at is not null and old.delivered_at is null then
      raise exception 'LOAD_NOT_DISPATCHED';
    end if;
    if new.released_at is not null and old.released_at is null then
      raise exception 'LOAD_NOT_DISPATCHED';
    end if;
    if new.active is false and old.active is true then
      raise exception 'LOAD_NOT_DISPATCHED';
    end if;
  end if;

  return new;
end;
$$;

create trigger shipments_guard_load_linked_mutation
before update of product, quantity, quantity_unit, delivered_at, released_at, active
on public.shipments
for each row execute function public.guard_load_linked_shipment_mutation();

revoke all on function public.guard_load_linked_shipment_mutation() from public, anon, authenticated;

comment on function public.guard_load_linked_shipment_mutation() is
'En shipments vinculados a Cargue, mercancía/cantidad son derivadas del load y entrega/liberación no pueden ocurrir antes del despacho físico.';
