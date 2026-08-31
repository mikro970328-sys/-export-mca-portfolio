-- P18 · Ensure stable milestone normalization matches the repository contract exactly.
-- Corrects the deployed unaccented ARRV spelling variant without changing claim history.

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

revoke all on function public.tracking_notification_delivery_key(text) from public,anon,authenticated,service_role;
