-- B3.4 · El helper de construcción física es interno.
-- Las mutaciones externas siguen entrando por create_load_plan / replace_load_plan / create_load_from_sales_order.

revoke execute on function public.insert_load_item_with_allocations(uuid,uuid,jsonb,text) from service_role;

comment on function public.insert_load_item_with_allocations(uuid,uuid,jsonb,text)
is 'Helper interno para construir load_item + load_allocations con cantidades normalizadas. No exponer directamente a API roles.';
