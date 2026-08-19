-- Corrige unidades inválidas y evita que cantidades terminen guardadas como unidad de medida.

update public.products
set unit = 'unidades'
where btrim(unit) ~ '^[0-9]+([.,][0-9]+)?$';

update public.products
set unit = 'paneles'
where lower(btrim(unit)) in ('panekes');

update public.load_items li
set unit = p.unit,
    updated_at = now()
from public.products p
where p.id = li.product_id
  and li.unit is distinct from p.unit;

alter table public.products
  add constraint products_unit_semantic_check
  check (
    length(btrim(unit)) > 0
    and btrim(unit) !~ '^[0-9]+([.,][0-9]+)?$'
  );

alter table public.load_items
  add constraint load_items_unit_semantic_check
  check (
    length(btrim(unit)) > 0
    and btrim(unit) !~ '^[0-9]+([.,][0-9]+)?$'
  );

create function public.guard_load_item_unit_matches_product()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_product_unit text;
begin
  select unit into v_product_unit
  from public.products
  where id = new.product_id;

  if not found then
    raise exception 'LOAD_PRODUCT_NOT_FOUND';
  end if;

  if btrim(new.unit) is distinct from btrim(v_product_unit) then
    raise exception 'LOAD_UNIT_MUST_MATCH_PRODUCT';
  end if;

  return new;
end;
$$;

create trigger load_items_guard_unit_matches_product
before insert or update of product_id, unit on public.load_items
for each row execute function public.guard_load_item_unit_matches_product();

revoke all on function public.guard_load_item_unit_matches_product() from public, anon, authenticated;

comment on constraint products_unit_semantic_check on public.products is 'La unidad debe ser textual; no puede ser una cantidad numérica.';
comment on constraint load_items_unit_semantic_check on public.load_items is 'La unidad del cargue debe ser textual; no puede ser una cantidad numérica.';
comment on function public.guard_load_item_unit_matches_product() is 'Impide que un cargue use una unidad distinta a la unidad canónica del producto.';
