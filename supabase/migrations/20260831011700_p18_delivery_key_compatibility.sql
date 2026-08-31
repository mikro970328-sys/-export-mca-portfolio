-- P18 · Stable milestone identity also protects legacy/direct claim inserts.

create or replace function public.tracking_notification_delivery_key(p_event_status text)
returns text
language sql
immutable
set search_path=public,pg_temp
as $$
  select case lower(btrim(coalesce(p_event_status,'')))
    when 'cargado en el buque' then 'tracking:LOAD'
    when 'salió del puerto' then 'tracking:DEPA'
    when 'salio del puerto' then 'tracking:DEPA'
    when 'llegó al puerto' then 'tracking:ARRV'
    when 'llego al puerto' then 'tracking:ARRV'
    when 'descargado del buque' then 'tracking:DISC'
    when 'salió de la terminal' then 'tracking:GTOT'
    when 'salio de la terminal' then 'tracking:GTOT'
    when 'liberado' then 'tracking:RELEASE'
    when 'entregado' then 'tracking:DELIVERED'
    else case when btrim(coalesce(p_event_status,''))='' then null else 'legacy:'||md5(lower(btrim(p_event_status))) end
  end;
$$;

create or replace function public.set_notification_dispatch_delivery_key()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if btrim(coalesce(new.delivery_key,''))='' then
    new.delivery_key:=public.tracking_notification_delivery_key(new.event_status);
  end if;
  if btrim(coalesce(new.delivery_key,''))='' then
    raise exception 'NOTIFICATION_DELIVERY_KEY_REQUIRED';
  end if;
  return new;
end;
$$;

revoke all on function public.tracking_notification_delivery_key(text) from public,anon,authenticated,service_role;
revoke all on function public.set_notification_dispatch_delivery_key() from public,anon,authenticated,service_role;

drop trigger if exists notification_dispatch_delivery_key_guard on public.notification_dispatch_claims;
create trigger notification_dispatch_delivery_key_guard
before insert or update of event_status,delivery_key on public.notification_dispatch_claims
for each row execute function public.set_notification_dispatch_delivery_key();
