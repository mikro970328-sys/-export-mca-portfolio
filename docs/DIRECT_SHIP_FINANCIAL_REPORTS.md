# Direct Ship: costos y reportes financieros

La revisión posterior a PR #316 reprodujo un defecto: el owner
sales_order_item_merchandise_cogs sólo incluía sales_fulfillment_allocations
(cargues de almacén). Una venta Direct Ship de 840 × USD 4, con compra de
840 × USD 2.50, no tenía COGS reconocido ni margen comparable.

La migración 20260916034831 amplía esa misma vista, manteniendo sus columnas,
security_invoker y permisos de backend. Incorpora las allocations Direct Ship
efectivas mediante su compra vinculada y el costo canónico de PO/Supplier Bills.
Conserva el criterio de asignaciones activas del owner existente: es rentabilidad
atribuida, no un asiento contable ni un registro exclusivo de despachos.

Se usa cantidad de compra × costo unitario de compra y se divide por cantidad
de venta sólo para obtener el costo unitario equivalente. No se asume que las
unidades compradas y vendidas sean iguales. Correcciones a cero no reconocen
asignación; costos desconocidos y monedas incompatibles mantienen margen nulo.
Las fuentes de almacén y Direct Ship se agregan sin duplicar ni crear stock.

Caso verificado en SQL: 840→810 cambia costo 2100→2025, venta atribuida
3360→3240 y deja 120 no atribuidos. Con gasto directo de 50, contribución 1165.
Factura emitida, cobros, factura de proveedor y pagos conservan importes; corregir
cantidad física no equivale a corregir deuda comercial. Si se facturaron 840 y
sólo hay 810 asignadas, la rentabilidad de la factura queda incompleta, no inventada.

14 escenarios SQL cubren estimado/actual/parcial, corrección, AR/AP/caja intactos,
reverso de pago, anulación de bill, costo ausente, unidades distintas, FX, cantidad
cero, ausencia de almacén y combinación de almacén más Direct Ship.
La suite de navegador Direct Ship amplía DS-01–DS-13 con segundo operador en
Reportes y DS-14–DS-15 para factura/cobro, costo directo, bill, pago y reverso.
Exige refresco de la segunda sesión sin navegación/recarga de documentos.

Pruebas en PostgreSQL desechable y PGlite; sin escritura comercial en producción.
CI, Preview, migración y publicación del head exacto se documentan en el PR.
Quedan fuera el ajuste comercial de facturas ya emitidas, todas las combinaciones
financieras posibles y la aceptación diaria integral del ERP.
