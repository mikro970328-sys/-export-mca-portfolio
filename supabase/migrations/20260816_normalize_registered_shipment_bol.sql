create or replace function public.normalize_shipment_bol_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.bol_number is not null then
    new.bol_number := upper(btrim(regexp_replace(new.bol_number, '\s+', ' ', 'g')));
    if new.bol_number = '' then
      new.bol_number := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists shipments_normalize_bol_number on public.shipments;
create trigger shipments_normalize_bol_number
before insert or update of bol_number on public.shipments
for each row execute function public.normalize_shipment_bol_number();
