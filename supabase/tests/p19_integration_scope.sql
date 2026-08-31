begin;

-- Deterministic fixture must not pre-exist.
do $$
begin
  if exists(select 1 from public.shipments where id='19000000-0000-4000-8000-000000000001'::uuid) then
    raise exception 'P19_FIXTURE_ALREADY_EXISTS';
  end if;
end;
$$;

insert into public.shipments(id,container_number,active,last_status,operational_status)
values('19000000-0000-4000-8000-000000000001'::uuid,'P19X0000001',true,'Registrado','Registrado');

do $$
declare
  v_claimed boolean;
begin
  if public.tracking_notification_delivery_key('Salió del puerto') <> 'tracking:DEPA' then raise exception 'P19_DEPA_KEY_INVALID'; end if;
  if public.tracking_notification_delivery_key('Liberado') <> 'tracking:RELEASE' then raise exception 'P19_RELEASE_KEY_INVALID'; end if;
  if public.tracking_notification_delivery_key('Cargado en el buque') is not null then raise exception 'P19_LOAD_MUST_NOT_NOTIFY'; end if;
  if public.tracking_notification_delivery_key('Llegó al puerto') is not null then raise exception 'P19_ARRV_MUST_NOT_NOTIFY'; end if;
  if public.tracking_notification_delivery_key('Descargado del buque') is not null then raise exception 'P19_DISC_MUST_NOT_NOTIFY'; end if;
  if public.tracking_notification_delivery_key('Entregado') is not null then raise exception 'P19_DELIVERED_MUST_NOT_NOTIFY'; end if;

  v_claimed := public.claim_notification_dispatch(
    '19000000-0000-4000-8000-000000000001'::uuid,'tracking:DEPA','Salió del puerto','p19_fixture'
  );
  if v_claimed is distinct from true then raise exception 'P19_DEPA_FIRST_CLAIM_FAILED'; end if;

  v_claimed := public.claim_notification_dispatch(
    '19000000-0000-4000-8000-000000000001'::uuid,'tracking:DEPA','Salió del puerto','p19_fixture'
  );
  if v_claimed is distinct from false then raise exception 'P19_DEPA_DEDUPE_FAILED'; end if;

  v_claimed := public.claim_notification_dispatch(
    '19000000-0000-4000-8000-000000000001'::uuid,'tracking:RELEASE','Liberado','p19_fixture'
  );
  if v_claimed is distinct from true then raise exception 'P19_RELEASE_FIRST_CLAIM_FAILED'; end if;

  begin
    perform public.claim_notification_dispatch(
      '19000000-0000-4000-8000-000000000001'::uuid,'tracking:LOAD','Cargado en el buque','p19_fixture'
    );
    raise exception 'P19_LOAD_CLAIM_WAS_NOT_BLOCKED';
  exception when others then
    if position('NOTIFICATION_DELIVERY_KEY_NOT_ALLOWED' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.claim_notification_dispatch(
      '19000000-0000-4000-8000-000000000001'::uuid,'tracking:ARRV','Llegó al puerto','p19_fixture'
    );
    raise exception 'P19_ARRV_CLAIM_WAS_NOT_BLOCKED';
  exception when others then
    if position('NOTIFICATION_DELIVERY_KEY_NOT_ALLOWED' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.claim_notification_dispatch(
      '19000000-0000-4000-8000-000000000001'::uuid,'tracking:DISC','Descargado del buque','p19_fixture'
    );
    raise exception 'P19_DISC_CLAIM_WAS_NOT_BLOCKED';
  exception when others then
    if position('NOTIFICATION_DELIVERY_KEY_NOT_ALLOWED' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.claim_notification_dispatch(
      '19000000-0000-4000-8000-000000000001'::uuid,'tracking:DELIVERED','Entregado','p19_fixture'
    );
    raise exception 'P19_DELIVERED_CLAIM_WAS_NOT_BLOCKED';
  exception when others then
    if position('NOTIFICATION_DELIVERY_KEY_NOT_ALLOWED' in sqlerrm)=0 then raise; end if;
  end;
end;
$$;

rollback;

select
  (select count(*) from public.shipments where id='19000000-0000-4000-8000-000000000001'::uuid) as shipment_fixture_residue,
  (select count(*) from public.notification_dispatch_claims where shipment_id='19000000-0000-4000-8000-000000000001'::uuid) as claim_fixture_residue;
