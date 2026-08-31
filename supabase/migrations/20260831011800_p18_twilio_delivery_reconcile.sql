-- P18 · Provider delivery callbacks are observations, not arbitrary mutable truth.

create or replace function public.twilio_delivery_rank(p_status text)
returns integer
language sql
immutable
set search_path=public,pg_temp
as $$
  select case lower(btrim(coalesce(p_status,'')))
    when 'accepted' then 10
    when 'scheduled' then 10
    when 'queued' then 20
    when 'sending' then 30
    when 'sent' then 40
    when 'delivered' then 50
    when 'read' then 60
    when 'undelivered' then 50
    when 'failed' then 50
    else 0
  end;
$$;

create or replace function public.reconcile_twilio_delivery_status(
  p_message_sid text,
  p_status text,
  p_error_code text default null,
  p_error_message text default null,
  p_now timestamptz default now()
)
returns table(
  notification_id uuid,
  matched boolean,
  applied boolean,
  previous_status text,
  current_status text
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_row public.notifications%rowtype;
  v_current text;
  v_incoming text:=lower(btrim(coalesce(p_status,'')));
  v_apply boolean:=false;
begin
  if btrim(coalesce(p_message_sid,''))='' then raise exception 'TWILIO_MESSAGE_SID_REQUIRED'; end if;
  if v_incoming='' then raise exception 'TWILIO_DELIVERY_STATUS_REQUIRED'; end if;

  select n.* into v_row
  from public.notifications n
  where n.notification_scope='message'
    and n.channel='whatsapp'
    and (n.provider_message_id=p_message_sid or n.twilio_message_sid=p_message_sid)
  order by n.created_at desc
  limit 1
  for update;

  if not found then
    return query select null::uuid,false,false,null::text,v_incoming;
    return;
  end if;

  v_current:=lower(btrim(coalesce(v_row.delivery_status,v_row.status,'')));

  if v_current in ('failed','undelivered','read') then
    v_apply:=v_current=v_incoming;
  elsif v_current='delivered' then
    v_apply:=v_incoming in ('delivered','read');
  else
    v_apply:=public.twilio_delivery_rank(v_incoming)>=public.twilio_delivery_rank(v_current);
  end if;

  if v_apply then
    update public.notifications n
    set status=v_incoming,
        delivery_status=v_incoming,
        error_code=nullif(btrim(coalesce(p_error_code,'')),''),
        error_message=nullif(btrim(coalesce(p_error_message,'')),''),
        updated_at=coalesce(p_now,now())
    where n.id=v_row.id;
  end if;

  return query select v_row.id,true,v_apply,nullif(v_current,''),case when v_apply then v_incoming else nullif(v_current,'') end;
end;
$$;

revoke all on function public.twilio_delivery_rank(text) from public,anon,authenticated,service_role;
revoke all on function public.reconcile_twilio_delivery_status(text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_twilio_delivery_status(text,text,text,text,timestamptz) to service_role;
