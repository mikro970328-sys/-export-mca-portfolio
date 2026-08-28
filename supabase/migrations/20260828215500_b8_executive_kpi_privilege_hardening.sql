-- B8.1 · mínimo privilegio para read-models ejecutivos.

revoke all on public.executive_invoice_kpi_source from service_role;
revoke all on public.executive_customer_payment_kpi_source from service_role;
revoke all on public.executive_supplier_bill_kpi_source from service_role;
revoke all on public.executive_supplier_payment_kpi_source from service_role;
revoke all on public.executive_purchase_order_kpi_source from service_role;
revoke all on public.executive_sales_order_kpi_source from service_role;

grant select on public.executive_invoice_kpi_source to service_role;
grant select on public.executive_customer_payment_kpi_source to service_role;
grant select on public.executive_supplier_bill_kpi_source to service_role;
grant select on public.executive_supplier_payment_kpi_source to service_role;
grant select on public.executive_purchase_order_kpi_source to service_role;
grant select on public.executive_sales_order_kpi_source to service_role;
